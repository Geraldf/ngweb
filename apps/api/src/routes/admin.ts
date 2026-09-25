import express from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJSON, writeJSON, withLock } from "../lib/storage.js";
import { requireAdmin, MigrationError } from "../middleware/admin.js";
import type { Booking, BookingFields } from "../types.js";

const DATA_MIGRATION_VERSION = 1;
const MIGRATION_IMPORT_LIMIT = "500mb";

type MigrationPackage = {
  migrationVersion: number;
  exportedAt: string;
  jsonFiles: Array<{ path: string; data: unknown }>;
  files: Array<{ path: string; data: string }>;
};

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function listDataFiles(directory: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) paths.push(...await listDataFiles(directory, relativePath));
    else if (entry.isFile()) paths.push(relativePath);
  }
  return paths.sort();
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") &&
    !path.posix.isAbsolute(value) && path.posix.normalize(value) === value &&
    !value.split("/").includes("..");
}

function validateMigration(value: unknown): MigrationPackage {
  if (!value || typeof value !== "object") throw new MigrationError("Die Migrationsdatei ist ungültig.");
  const migration = value as Partial<MigrationPackage>;
  if (migration.migrationVersion !== DATA_MIGRATION_VERSION) {
    throw new MigrationError(`Nicht unterstützte Migrationsversion ${String(migration.migrationVersion)}. Erwartet wird Version ${DATA_MIGRATION_VERSION}.`);
  }
  if (!Array.isArray(migration.jsonFiles) || !Array.isArray(migration.files)) {
    throw new MigrationError("Die Migrationsdatei enthält nicht alle erforderlichen Bereiche.");
  }
  const paths = new Set<string>();
  for (const entry of migration.jsonFiles) {
    if (!entry || !isSafeRelativePath(entry.path) || !entry.path.endsWith(".json")) throw new MigrationError("Die Migration enthält einen ungültigen JSON-Dateipfad.");
    if (paths.has(entry.path)) throw new MigrationError(`Der Dateipfad ${entry.path} ist doppelt vorhanden.`);
    paths.add(entry.path);
  }
  for (const entry of migration.files) {
    if (!entry || !isSafeRelativePath(entry.path) || entry.path.endsWith(".json") || typeof entry.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)) {
      throw new MigrationError("Die Migration enthält eine ungültige Bild- oder Datendatei.");
    }
    if (paths.has(entry.path)) throw new MigrationError(`Der Dateipfad ${entry.path} ist doppelt vorhanden.`);
    paths.add(entry.path);
  }
  return migration as MigrationPackage;
}

async function validateStagedMedia(directory: string, migration: MigrationPackage) {
  const mediaEntry = migration.jsonFiles.find((entry) => entry.path === "media.json");
  if (!mediaEntry) return;
  if (!Array.isArray(mediaEntry.data)) throw new MigrationError("media.json muss eine Liste enthalten.");
  const filePaths = new Set(migration.files.map((entry) => entry.path));
  for (const item of mediaEntry.data as Array<{ filename?: unknown }>) {
    if (!item || typeof item.filename !== "string" || !isSafeRelativePath(item.filename) || !filePaths.has(path.posix.join("files", item.filename))) {
      throw new MigrationError("Mindestens ein Bild aus media.json fehlt in der Migrationsdatei.");
    }
  }
  await Promise.all(migration.jsonFiles.map(async (entry) => {
    JSON.parse(await readFile(path.join(directory, entry.path), "utf8"));
  }));
}

function bookingFields(body: Record<string, unknown>): BookingFields | undefined {
  const arrival = typeof body.arrival === "string" ? body.arrival : "";
  const departure = typeof body.departure === "string" ? body.departure : "";
  const start = new Date(`${arrival}T00:00:00Z`);
  const end = new Date(`${departure}T00:00:00Z`);
  const stayNights = (end.getTime() - start.getTime()) / 86_400_000;
  const guests = Number(body.guests);
  const status = body.status === "booked" || body.status === "reserved" ? body.status : "requested";
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || stayNights < 10 ||
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

function normalizedStatus(status: Booking["status"]): NonNullable<Booking["status"]> {
  return status === "booked" || status === "requested" ? status : "reserved";
}

export function createAdminRouter(dataDirectory: string, bookingsFile: string): Router {
  const router = Router();

  router.get("/session", requireAdmin, (_request, response) => {
    response.status(204).end();
  });

  // Booking management
  router.get("/bookings", requireAdmin, async (_request, response, next) => {
    try {
      const bookings = await readJSON<Booking[]>(bookingsFile, []);
      response.json(bookings.map((booking) => ({ ...booking, status: normalizedStatus(booking.status) })));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bookings", requireAdmin, async (request, response, next) => {
    try {
      const fields = bookingFields(request.body as Record<string, unknown>);
      if (!fields) {
        response.status(400).json({ message: "Bitte prüfen Sie alle Buchungsdaten." });
        return;
      }
      const booking = await withLock(bookingsFile, async () => {
        const bookings = await readJSON<Booking[]>(bookingsFile, []);
        if (overlapsBooking(bookings, fields)) {
          return null;
        }
        const newBooking: Booking = { id: randomUUID(), ...fields, createdAt: new Date().toISOString() };
        await writeJSON(bookingsFile, [...bookings, newBooking]);
        return newBooking;
      });
      if (!booking) {
        response.status(409).json({ message: "Der Zeitraum überschneidet sich mit einer bestehenden Buchung." });
        return;
      }
      response.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/bookings/:id", requireAdmin, async (request, response, next) => {
    try {
      const updated = await withLock(bookingsFile, async () => {
        const bookings = await readJSON<Booking[]>(bookingsFile, []);
        const index = bookings.findIndex((booking) => booking.id === request.params.id);
        if (index === -1) {
          return null;
        }
        const fields = bookingFields({ ...bookings[index], ...(request.body as Record<string, unknown>) });
        if (!fields) {
          return undefined;
        }
        if (overlapsBooking(bookings, fields, bookings[index].id)) {
          return false;
        }
        bookings[index] = { ...bookings[index], ...fields };
        await writeJSON(bookingsFile, bookings);
        return bookings[index];
      });
      if (updated === null) {
        response.status(404).json({ message: "Buchung nicht gefunden." });
        return;
      }
      if (updated === undefined) {
        response.status(400).json({ message: "Bitte prüfen Sie alle Buchungsdaten." });
        return;
      }
      if (updated === false) {
        response.status(409).json({ message: "Der Zeitraum überschneidet sich mit einer bestehenden Buchung." });
        return;
      }
      response.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/bookings/:id", requireAdmin, async (request, response, next) => {
    try {
      await withLock(bookingsFile, async () => {
        const bookings = await readJSON<Booking[]>(bookingsFile, []);
        if (!bookings.some((booking) => booking.id === request.params.id)) {
          return;
        }
        await writeJSON(bookingsFile, bookings.filter((booking) => booking.id !== request.params.id));
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Migration
  router.get("/migration/export", requireAdmin, async (_request, response, next) => {
    try {
      const paths = await listDataFiles(dataDirectory);
      const migration: MigrationPackage = {
        migrationVersion: DATA_MIGRATION_VERSION,
        exportedAt: new Date().toISOString(),
        jsonFiles: [],
        files: [],
      };
      for (const relativePath of paths) {
        const contents = await readFile(path.join(dataDirectory, relativePath));
        if (relativePath.endsWith(".json")) {
          migration.jsonFiles.push({ path: relativePath, data: JSON.parse(contents.toString("utf8")) as unknown });
        } else {
          migration.files.push({ path: relativePath, data: contents.toString("base64") });
        }
      }
      const date = new Date().toISOString().slice(0, 10);
      response.set("Content-Disposition", `attachment; filename="casa-baia-migration-v${DATA_MIGRATION_VERSION}-${date}.json"`);
      response.json(migration);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/migration/import",
    requireAdmin,
    express.raw({ type: "application/json", limit: MIGRATION_IMPORT_LIMIT }),
    async (request, response, next) => {
      let stagingDirectory: string | undefined;
      let backupDirectory: string | undefined;
      let oldDataMoved = false;
      try {
        let bodyContent: Buffer;
        if (Buffer.isBuffer(request.body)) {
          bodyContent = request.body;
        } else if (typeof request.body === "string") {
          if (request.body.length === 0) throw new MigrationError("Die Migrationsdatei ist leer oder ungültig.");
          bodyContent = Buffer.from(request.body, "utf8");
        } else if (typeof request.body === "object" && request.body !== null) {
          bodyContent = Buffer.from(JSON.stringify(request.body), "utf8");
        } else {
          throw new MigrationError("Die Migrationsdatei ist leer oder ungültig.");
        }
        const migration = validateMigration(JSON.parse(bodyContent.toString("utf8")) as unknown);
        const parentDirectory = path.dirname(dataDirectory);
        await mkdir(parentDirectory, { recursive: true });
        stagingDirectory = await mkdtemp(path.join(parentDirectory, ".migration-import-"));

        for (const entry of migration.jsonFiles) {
          const destination = path.join(stagingDirectory, entry.path);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, JSON.stringify(entry.data, null, 2));
        }
        for (const entry of migration.files) {
          const destination = path.join(stagingDirectory, entry.path);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, Buffer.from(entry.data, "base64"));
        }
        await validateStagedMedia(stagingDirectory, migration);

        if (await pathExists(dataDirectory)) {
          backupDirectory = path.join(parentDirectory, `.migration-backup-${randomUUID()}`);
          await rename(dataDirectory, backupDirectory);
          oldDataMoved = true;
        }
        await rename(stagingDirectory, dataDirectory);
        stagingDirectory = undefined;
        oldDataMoved = false;
        if (backupDirectory) await rm(backupDirectory, { recursive: true, force: true }).catch((error) => {
          console.error("The migration backup could not be removed.", error);
        });

        response.json({
          message: "Migration wurde erfolgreich importiert.",
          migrationVersion: DATA_MIGRATION_VERSION,
          jsonFiles: migration.jsonFiles.length,
          files: migration.files.length,
        });
      } catch (error) {
        if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
        if (oldDataMoved && backupDirectory && !(await pathExists(dataDirectory))) {
          await rename(backupDirectory, dataDirectory).catch(() => undefined);
        }
        if (error instanceof MigrationError || error instanceof SyntaxError) {
          response.status(400).json({ message: error instanceof SyntaxError ? "Die Datei enthält kein gültiges JSON." : error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
