import express from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJSON, writeJSON, ensureDir, withLock } from "../lib/storage.js";
import { requireAdmin } from "../middleware/admin.js";
import type { MediaItem } from "../types.js";

const SUPPORTED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function createMediaRouter(indexFile: string, filesDir: string): Router {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await readJSON<MediaItem[]>(indexFile, []));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/",
    requireAdmin,
    express.raw({ type: Object.keys(SUPPORTED_TYPES), limit: "10mb" }),
    async (request, response, next) => {
      try {
        const mimeType = request.headers["content-type"]?.split(";")[0] ?? "";
        const extension = SUPPORTED_TYPES[mimeType];
        if (!extension || !Buffer.isBuffer(request.body) || request.body.length === 0) {
          response.status(400).json({ message: "Please upload a JPEG, PNG, WebP, or GIF image." });
          return;
        }

        const id = randomUUID();
        const filename = `${id}${extension}`;
        const suppliedName = String(request.headers["x-file-name"] ?? "Image");
        const title = decodeURIComponent(suppliedName).replace(/\.[^.]+$/, "").slice(0, 100) || "Image";

        const item = await withLock(indexFile, async () => {
          const items = await readJSON<MediaItem[]>(indexFile, []);
          const newItem: MediaItem = {
            id,
            filename,
            title,
            mimeType,
            placement: "gallery",
            order: items.reduce((highest, current) => Math.max(highest, current.order), 0) + 1,
            createdAt: new Date().toISOString(),
          };
          await writeJSON(indexFile, [...items, newItem]);
          return newItem;
        });

        await ensureDir(filesDir);
        await writeFile(path.join(filesDir, filename), request.body);

        response.status(201).json(item);
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch("/:id", requireAdmin, async (request, response, next) => {
    try {
      const result = await withLock(indexFile, async () => {
        const items = await readJSON<MediaItem[]>(indexFile, []);
        const index = items.findIndex((item) => item.id === request.params.id);
        if (index === -1) {
          return null;
        }
        const placement = request.body.placement;
        const title = request.body.title;
        const order = request.body.order;
        if (placement !== undefined && placement !== "library" && placement !== "gallery") {
          return undefined;
        }
        items[index] = {
          ...items[index],
          ...(placement !== undefined ? { placement } : {}),
          ...(typeof title === "string" ? { title: title.trim().slice(0, 100) || "Image" } : {}),
          ...(Number.isFinite(order) ? { order: Number(order) } : {}),
        };
        await writeJSON(indexFile, items);
        return items[index];
      });
      if (result === null) {
        response.status(404).json({ message: "Image not found." });
        return;
      }
      if (result === undefined) {
        response.status(400).json({ message: "Invalid placement." });
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.put("/order", requireAdmin, async (request, response, next) => {
    try {
      const result = await withLock(indexFile, async () => {
        const items = await readJSON<MediaItem[]>(indexFile, []);
        const ids = request.body.ids;
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
          return undefined;
        }

        const requestedIds = new Set(ids);
        if (requestedIds.size !== ids.length || ids.length !== items.length || items.some((item) => !requestedIds.has(item.id))) {
          return false;
        }

        const positionById = new Map(ids.map((id, index) => [id, index + 1]));
        const reordered = items.map((item) => ({ ...item, order: positionById.get(item.id)! }));
        await writeJSON(indexFile, reordered);
        return reordered;
      });
      if (result === undefined) {
        response.status(400).json({ message: "Please provide the image IDs in their desired order." });
        return;
      }
      if (result === false) {
        response.status(400).json({ message: "The image order must include every image exactly once." });
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", requireAdmin, async (request, response, next) => {
    try {
      await withLock(indexFile, async () => {
        const items = await readJSON<MediaItem[]>(indexFile, []);
        const item = items.find((candidate) => candidate.id === request.params.id);
        if (!item) {
          return;
        }
        await unlink(path.join(filesDir, item.filename)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        await writeJSON(indexFile, items.filter((candidate) => candidate.id !== item.id));
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
