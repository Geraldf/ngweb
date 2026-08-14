import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
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

type Booking = {
  id: string;
  arrival: string;
  departure: string;
  status?: "requested" | "reserved" | "booked";
  name: string;
  email: string;
  guests: number;
  message: string;
  createdAt: string;
};

type BookingFields = Omit<Booking, "id" | "createdAt">;

const app = express();
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = path.resolve(process.env.MEDIA_DATA_DIR ?? "data/media");
const webDirectory = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : undefined;
const filesDirectory = path.join(dataDirectory, "files");
const indexFile = path.join(dataDirectory, "media.json");
const bookingsFile = path.join(dataDirectory, "bookings.json");
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

async function readBookings(): Promise<Booking[]> {
  try {
    return JSON.parse(await readFile(bookingsFile, "utf8")) as Booking[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveBookings(bookings: Booking[]) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(bookingsFile, JSON.stringify(bookings, null, 2));
}

function bookingFields(body: Record<string, unknown>): BookingFields | undefined {
  const arrival = typeof body.arrival === "string" ? body.arrival : "";
  const departure = typeof body.departure === "string" ? body.departure : "";
  const start = new Date(`${arrival}T00:00:00Z`);
  const end = new Date(`${departure}T00:00:00Z`);
  const guests = Number(body.guests);
  const status = body.status === "booked" || body.status === "reserved" ? body.status : "requested";
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start ||
      typeof body.name !== "string" || !body.name.trim() || typeof body.email !== "string" || !body.email.includes("@") ||
      !Number.isInteger(guests) || guests < 1 || guests > 4) return undefined;
  return {
    arrival,
    departure,
    status,
    name: body.name.trim().slice(0, 120),
    email: body.email.trim().slice(0, 200),
    guests,
    message: typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "",
  };
}

function overlapsBooking(bookings: Booking[], fields: BookingFields, ignoredId?: string) {
  return bookings.some((booking) => booking.id !== ignoredId && booking.status !== "requested" && fields.arrival < booking.departure && fields.departure > booking.arrival);
}

function normalizedStatus(status: Booking["status"]) {
  return status === "booked" || status === "requested" ? status : "reserved";
}

function requireAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    response.status(503).json({ message: "Die Verwaltung ist nicht konfiguriert." });
    return;
  }

  const authorization = request.get("authorization") ?? "";
  const supplied = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    response.set("WWW-Authenticate", "Bearer");
    response.status(401).json({ message: "Der Verwaltungsschlüssel ist ungültig." });
    return;
  }

  next();
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

app.get("/api/bookings", async (_request, response, next) => {
  try {
    const bookings = await readBookings();
    response.json(bookings.map(({ arrival, departure, status }) => ({
      arrival,
      departure,
      status: normalizedStatus(status),
    })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/bookings", async (request, response, next) => {
  try {
    const fields = bookingFields({ ...(request.body as Record<string, unknown>), status: "requested" });
    if (!fields) {
      response.status(400).json({ message: "Bitte prüfen Sie Ihre Reisedaten und Kontaktdaten." });
      return;
    }
    const bookings = await readBookings();
    if (overlapsBooking(bookings, fields)) {
      response.status(409).json({ message: "Dieser Zeitraum ist leider nicht mehr verfügbar." });
      return;
    }
    const booking: Booking = {
      id: randomUUID(),
      ...fields,
      createdAt: new Date().toISOString(),
    };
    await saveBookings([...bookings, booking]);
    response.status(201).json({ id: booking.id, message: "Ihre Buchungsanfrage ist bei uns eingegangen." });
  } catch (error) {
    next(error);
  }
});

app.use("/api/admin", requireAdmin);

app.get("/api/admin/session", (_request, response) => {
  response.status(204).end();
});

app.get("/api/admin/bookings", async (_request, response, next) => {
  try {
    const bookings = await readBookings();
    response.json(bookings.map((booking) => ({ ...booking, status: normalizedStatus(booking.status) })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/bookings", async (request, response, next) => {
  try {
    const fields = bookingFields(request.body as Record<string, unknown>);
    if (!fields) {
      response.status(400).json({ message: "Bitte prüfen Sie alle Buchungsdaten." });
      return;
    }
    const bookings = await readBookings();
    if (overlapsBooking(bookings, fields)) {
      response.status(409).json({ message: "Der Zeitraum überschneidet sich mit einer bestehenden Buchung." });
      return;
    }
    const booking: Booking = { id: randomUUID(), ...fields, createdAt: new Date().toISOString() };
    await saveBookings([...bookings, booking]);
    response.status(201).json(booking);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/bookings/:id", async (request, response, next) => {
  try {
    const bookings = await readBookings();
    const index = bookings.findIndex((booking) => booking.id === request.params.id);
    if (index === -1) {
      response.status(404).json({ message: "Buchung nicht gefunden." });
      return;
    }
    const fields = bookingFields({ ...bookings[index], ...(request.body as Record<string, unknown>) });
    if (!fields) {
      response.status(400).json({ message: "Bitte prüfen Sie alle Buchungsdaten." });
      return;
    }
    if (overlapsBooking(bookings, fields, bookings[index].id)) {
      response.status(409).json({ message: "Der Zeitraum überschneidet sich mit einer bestehenden Buchung." });
      return;
    }
    bookings[index] = { ...bookings[index], ...fields };
    await saveBookings(bookings);
    response.json(bookings[index]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/bookings/:id", async (request, response, next) => {
  try {
    const bookings = await readBookings();
    if (!bookings.some((booking) => booking.id === request.params.id)) {
      response.status(404).json({ message: "Buchung nicht gefunden." });
      return;
    }
    await saveBookings(bookings.filter((booking) => booking.id !== request.params.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/media",
  requireAdmin,
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

app.patch("/api/media/:id", requireAdmin, async (request, response, next) => {
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

app.put("/api/media/order", requireAdmin, async (request, response, next) => {
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

app.delete("/api/media/:id", requireAdmin, async (request, response, next) => {
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

if (webDirectory) {
  app.use(express.static(webDirectory, { index: "index.html", maxAge: "1h" }));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(webDirectory, "index.html"));
  });
}

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
