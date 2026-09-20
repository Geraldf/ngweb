import express from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJSON, writeJSON, ensureDir } from "../lib/storage.js";
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

  async function readMedia(): Promise<MediaItem[]> {
    return readJSON<MediaItem[]>(indexFile, []);
  }

  async function saveMedia(items: MediaItem[]) {
    await writeJSON(indexFile, items);
  }

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await readMedia());
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

        const items = await readMedia();
        const id = randomUUID();
        const filename = `${id}${extension}`;
        const suppliedName = String(request.headers["x-file-name"] ?? "Image");
        const title = decodeURIComponent(suppliedName).replace(/\.[^.]+$/, "").slice(0, 100) || "Image";
        const item: MediaItem = {
          id,
          filename,
          title,
          mimeType,
          placement: "gallery",
          order: items.reduce((highest, current) => Math.max(highest, current.order), 0) + 1,
          createdAt: new Date().toISOString(),
        };
        await ensureDir(filesDir);
        await writeFile(path.join(filesDir, filename), request.body);
        await saveMedia([...items, item]);
        response.status(201).json(item);
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch("/:id", requireAdmin, async (request, response, next) => {
    try {
      const items = await readMedia();
      const index = items.findIndex((item) => item.id === request.params.id);
      if (index === -1) {
        response.status(404).json({ message: "Image not found." });
        return;
      }
      const placement = request.body.placement;
      const title = request.body.title;
      const order = request.body.order;
      if (placement !== undefined && placement !== "library" && placement !== "gallery") {
        response.status(400).json({ message: "Invalid placement." });
        return;
      }
      items[index] = {
        ...items[index],
        ...(placement !== undefined ? { placement } : {}),
        ...(typeof title === "string" ? { title: title.trim().slice(0, 100) || "Image" } : {}),
        ...(Number.isFinite(order) ? { order: Number(order) } : {}),
      };
      await saveMedia(items);
      response.json(items[index]);
    } catch (error) {
      next(error);
    }
  });

  router.put("/order", requireAdmin, async (request, response, next) => {
    try {
      const items = await readMedia();
      const ids = request.body.ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        response.status(400).json({ message: "Please provide the image IDs in their desired order." });
        return;
      }

      const requestedIds = new Set(ids);
      if (requestedIds.size !== ids.length || ids.length !== items.length || items.some((item) => !requestedIds.has(item.id))) {
        response.status(400).json({ message: "The image order must include every image exactly once." });
        return;
      }

      const positionById = new Map(ids.map((id, index) => [id, index + 1]));
      const reordered = items.map((item) => ({ ...item, order: positionById.get(item.id)! }));
      await saveMedia(reordered);
      response.json(reordered);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", requireAdmin, async (request, response, next) => {
    try {
      const items = await readMedia();
      const item = items.find((candidate) => candidate.id === request.params.id);
      if (!item) {
        response.status(404).json({ message: "Image not found." });
        return;
      }
      await unlink(path.join(filesDir, item.filename)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await saveMedia(items.filter((candidate) => candidate.id !== item.id));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
