import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { createBookingRouter } from "./routes/bookings.js";
import { createMediaRouter } from "./routes/media.js";
import { createPricingRouter } from "./routes/pricing.js";
import { createAdminRouter } from "./routes/admin.js";
import { createCalendarRouter } from "./routes/calendar.js";
import { createMcpRouter } from "./mcp.js";
import { requireAdmin } from "./middleware/admin.js";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const DATA_MIGRATION_VERSION = 1;
const MIGRATION_IMPORT_LIMIT = "500mb";
const MIGRATION_IMPORT_LIMIT_LABEL = "500 MB";
const MINIMUM_STAY_NIGHTS = 10;

const app = express();
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = path.resolve(process.env.MEDIA_DATA_DIR ?? "data/media");
const webDirectory = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : undefined;
const filesDirectory = path.join(dataDirectory, "files");
const indexFile = path.join(dataDirectory, "media.json");
const bookingsFile = path.join(dataDirectory, "bookings.json");
const pricingFile = path.join(dataDirectory, "pricing.json");
const calendarTemplateFile = path.resolve(import.meta.dirname, "../assets/kalender-2027-template.xlsx");

const allowedOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const localhostOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = allowedOrigin.split(",").map((value) => value.trim());
    if (allowed.includes(origin) || localhostOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
}));

app.use(express.json({ limit: "500mb" }));
app.use("/uploads", express.static(filesDirectory, { fallthrough: false, maxAge: "1d" }));

// Health check
app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "fuchsclan-api" });
});

// Public routes
app.use("/api/bookings", createBookingRouter(bookingsFile));
app.use("/api/media", createMediaRouter(indexFile, filesDirectory));
app.use("/api/pricing", createPricingRouter(pricingFile));

// Admin routes
app.use("/api/admin", createAdminRouter(dataDirectory, bookingsFile));
app.use("/api/admin", createCalendarRouter(bookingsFile, calendarTemplateFile));

// MCP server
import type { McpToolSet } from "./mcp.js";
import { readJSON } from "./lib/storage.js";

const mcpTools: McpToolSet = {
  list_gallery_photos: {
    name: "list_gallery_photos",
    description: "List all gallery photos displayed on the Casa Baia Sant'Anna website with their titles.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const items = await readJSON<Array<{ id: string; title: string; placement: string; order: number }>>(indexFile, []);
      const gallery = items.filter((item) => item.placement === "gallery").sort((a, b) => a.order - b.order);
      return {
        photos: gallery.map((item) => ({ id: item.id, title: item.title, placement: item.placement, order: item.order })),
        total: gallery.length,
      };
    },
  },
  check_availability: {
    name: "check_availability",
    description: "Check whether a specific date range is available for booking.",
    inputSchema: {
      type: "object",
      properties: {
        arrival: { type: "string", description: "Check-in date in YYYY-MM-DD format" },
        departure: { type: "string", description: "Check-out date in YYYY-MM-DD format" },
      },
      required: ["arrival", "departure"],
    },
    handler: async (args) => {
      const arrival = String(args.arrival ?? "");
      const departure = String(args.departure ?? "");
      if (!arrival || !departure) throw new Error("arrival and departure are required");
      if (departure <= arrival) throw new Error("departure must be after arrival");
      const bookings = await readJSON<Array<{ arrival: string; departure: string; status?: string }>>(bookingsFile, []);
      const conflicts = bookings.filter((b) => b.status !== "requested" && arrival < b.departure && departure > b.arrival);
      return {
        available: conflicts.length === 0,
        arrival,
        departure,
        conflicts: conflicts.map((b) => ({ arrival: b.arrival, departure: b.departure, status: b.status })),
      };
    },
  },
  get_pricing: {
    name: "get_pricing",
    description: "Get current seasonal pricing per night and fee information.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const pricing = await readJSON<{ lowSeason: number; midSeason: number; highSeason: number }>(pricingFile, { lowSeason: 120, midSeason: 160, highSeason: 210 });
      return {
        currency: "EUR",
        lowSeason: { nightlyRate: pricing.lowSeason, months: "November–March" },
        midSeason: { nightlyRate: pricing.midSeason, months: "April–June, October" },
        highSeason: { nightlyRate: pricing.highSeason, months: "July–September" },
        cleaningFee: 150,
        laundryFeePerGuest: 25,
        minimumStayNights: MINIMUM_STAY_NIGHTS,
      };
    },
  },
};

app.use("/mcp", createMcpRouter(mcpTools));

// Static web serving
if (webDirectory) {
  app.use(express.static(webDirectory, { index: "index.html", maxAge: "1h" }));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(webDirectory, "index.html"));
  });
}

// Error handler
app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if ((error as { type?: string }).type === "entity.too.large") {
    response.status(413).json({ message: request.path.includes("/migration/import") ? `Migrationsdateien dürfen maximal ${MIGRATION_IMPORT_LIMIT_LABEL} groß sein.` : "Images may be up to 10 MB." });
    return;
  }
  response.status(500).json({ message: "The media library could not be updated." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://localhost:${port}`);
});
