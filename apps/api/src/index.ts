import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type MediaItem = {
  id: string;
  filename: string;
  title: string;
  mimeType: string;
  placement: "library" | "gallery";
  order: number;
  createdAt: string;
};

const app = express();
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = path.resolve(process.env.MEDIA_DATA_DIR ?? "data/media");
const filesDirectory = path.join(dataDirectory, "files");
const indexFile = path.join(dataDirectory, "media.json");
const supportedTypes: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());
app.use("/uploads", express.static(filesDirectory, { fallthrough: false, maxAge: "1d" }));

async function readMedia(): Promise<MediaItem[]> {
  try {
    return JSON.parse(await readFile(indexFile, "utf8")) as MediaItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveMedia(items: MediaItem[]) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(indexFile, JSON.stringify(items, null, 2));
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "fuchsclan-api" });
});

app.get("/api/media", async (_request, response, next) => {
  try {
    response.json(await readMedia());
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/media",
  express.raw({ type: Object.keys(supportedTypes), limit: "10mb" }),
  async (request, response, next) => {
    try {
      const mimeType = request.headers["content-type"]?.split(";")[0] ?? "";
      const extension = supportedTypes[mimeType];
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
      await mkdir(filesDirectory, { recursive: true });
      await writeFile(path.join(filesDirectory, filename), request.body);
      await saveMedia([...items, item]);
      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  },
);

app.patch("/api/media/:id", async (request, response, next) => {
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

app.put("/api/media/order", async (request, response, next) => {
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

app.delete("/api/media/:id", async (request, response, next) => {
  try {
    const items = await readMedia();
    const item = items.find((candidate) => candidate.id === request.params.id);
    if (!item) {
      response.status(404).json({ message: "Image not found." });
      return;
    }
    await unlink(path.join(filesDirectory, item.filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await saveMedia(items.filter((candidate) => candidate.id !== item.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if ((error as { type?: string }).type === "entity.too.large") {
    response.status(413).json({ message: "Images may be up to 10 MB." });
    return;
  }
  response.status(500).json({ message: "The media library could not be updated." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://localhost:${port}`);
});
