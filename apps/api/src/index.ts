import cors from "cors";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const DATA_MIGRATION_VERSION = 1;
const MIGRATION_IMPORT_LIMIT = "500mb";
const MIGRATION_IMPORT_LIMIT_LABEL = "500 MB";
const MINIMUM_STAY_NIGHTS = 10;

type MigrationPackage = {
  migrationVersion: number;
  exportedAt: string;
  jsonFiles: Array<{ path: string; data: unknown }>;
  files: Array<{ path: string; data: string }>;
};

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
type Pricing = { lowSeason: number; midSeason: number; highSeason: number };

const defaultPricing: Pricing = { lowSeason: 120, midSeason: 160, highSeason: 210 };

const app = express();
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = path.resolve(process.env.MEDIA_DATA_DIR ?? "data/media");
const webDirectory = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : undefined;
const filesDirectory = path.join(dataDirectory, "files");
const indexFile = path.join(dataDirectory, "media.json");
const bookingsFile = path.join(dataDirectory, "bookings.json");
const pricingFile = path.join(dataDirectory, "pricing.json");
const calendarTemplateFile = path.resolve(import.meta.dirname, "../assets/kalender-2027-template.xlsx");
const supportedTypes: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" }));

app.get("/api/admin/migration/export", requireAdmin, async (_request, response, next) => {
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

app.post(
  "/api/admin/migration/import",
  requireAdmin,
  express.raw({ type: "application/json", limit: MIGRATION_IMPORT_LIMIT }),
  async (request, response, next) => {
    let stagingDirectory: string | undefined;
    let backupDirectory: string | undefined;
    let oldDataMoved = false;
    try {
      if (!Buffer.isBuffer(request.body)) throw new MigrationError("Die Migrationsdatei ist leer oder ungültig.");
      const migration = validateMigration(JSON.parse(request.body.toString("utf8")) as unknown);
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

app.use(express.json());
app.use("/uploads", express.static(filesDirectory, { fallthrough: false, maxAge: "1d" }));

class MigrationError extends Error {}

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

function pricingFields(body: Record<string, unknown>): Pricing | undefined {
  const pricing = {
    lowSeason: Number(body.lowSeason),
    midSeason: Number(body.midSeason),
    highSeason: Number(body.highSeason),
  };
  return Object.values(pricing).every((rate) => Number.isInteger(rate) && rate >= 1 && rate <= 10_000) ? pricing : undefined;
}

async function readPricing(): Promise<Pricing> {
  try {
    const parsed = JSON.parse(await readFile(pricingFile, "utf8")) as Record<string, unknown>;
    const pricing = pricingFields(parsed);
    if (!pricing) throw new Error("Die gespeicherte Preiskonfiguration ist ungültig.");
    return pricing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultPricing;
    throw error;
  }
}

async function savePricing(pricing: Pricing) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(pricingFile, JSON.stringify(pricing, null, 2));
}

function bookingFields(body: Record<string, unknown>): BookingFields | undefined {
  const arrival = typeof body.arrival === "string" ? body.arrival : "";
  const departure = typeof body.departure === "string" ? body.departure : "";
  const start = new Date(`${arrival}T00:00:00Z`);
  const end = new Date(`${departure}T00:00:00Z`);
  const stayNights = (end.getTime() - start.getTime()) / 86_400_000;
  const guests = Number(body.guests);
  const status = body.status === "booked" || body.status === "reserved" ? body.status : "requested";
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || stayNights < MINIMUM_STAY_NIGHTS ||
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

function excelDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

async function createBookingCalendar(bookings: Booking[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(calendarTemplateFile);
  const calendar = workbook.getWorksheet("Kalender 2027");
  if (!calendar) throw new Error("Das Kalenderblatt der Excel-Vorlage fehlt.");

  const exportedBookings = bookings
    .map((booking) => ({ ...booking, status: normalizedStatus(booking.status) }))
    .filter((booking): booking is Booking & { status: "reserved" | "booked" } => booking.status === "reserved" || booking.status === "booked")
    .sort((a, b) => a.arrival.localeCompare(b.arrival));
  const fills = {
    reserved: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } },
    booked: { type: "pattern", pattern: "solid", fgColor: { argb: "FF70AD47" } },
  } satisfies Record<"reserved" | "booked", ExcelJS.Fill>;
  const applyFill = (cell: ExcelJS.Cell, fill: ExcelJS.Fill) => {
    // Template cells share style objects. Replacing the complete style keeps a
    // fill change local instead of recoloring every cell using that style.
    cell.style = { ...cell.style, fill };
  };

  for (const booking of exportedBookings) {
    const start = excelDate(booking.arrival);
    const end = excelDate(booking.departure);
    const firstVisibleNight = Math.max(start.getTime(), Date.UTC(2027, 0, 1));
    for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
      if (date.getUTCFullYear() !== 2027) continue;
      const row = date.getUTCDate() + 2;
      const firstColumn = date.getUTCMonth() * 4 + 1;
      for (let column = firstColumn; column <= firstColumn + 2; column += 1) {
        applyFill(calendar.getCell(row, column), fills[booking.status]);
      }
      calendar.getCell(row, firstColumn).note = `${booking.status === "booked" ? "Gebucht" : "Reserviert"}: ${booking.name}\n${booking.arrival} – ${booking.departure}`;

      if (date.getTime() === firstVisibleNight || date.getUTCDate() === 1) {
        const nameCell = calendar.getCell(row, firstColumn + 2);
        const existingText = typeof nameCell.value === "string" ? nameCell.value.trim() : "";
        nameCell.value = existingText ? `${existingText}\n${booking.name}` : booking.name;
        nameCell.style = {
          ...nameCell.style,
          font: { ...nameCell.font, bold: true, size: 7, color: { argb: "FF1E2A20" } },
          alignment: { ...nameCell.alignment, vertical: "middle", wrapText: true, shrinkToFit: true },
        };
        calendar.getRow(row).height = Math.max(calendar.getRow(row).height ?? 0, existingText ? 26 : 20);
      }
    }
  }

  calendar.getCell("A36").value = "Legende";
  calendar.getCell("A36").font = { bold: true };
  calendar.getCell("B36").value = "Reserviert";
  applyFill(calendar.getCell("B36"), fills.reserved);
  calendar.getCell("D36").value = "Gebucht";
  applyFill(calendar.getCell("D36"), fills.booked);
  calendar.pageSetup = {
    ...calendar.pageSetup,
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    verticalCentered: true,
    showGridLines: false,
    printArea: "A1:AV36",
    margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.35, header: 0.15, footer: 0.2 },
  };
  calendar.headerFooter.oddFooter = "&LKalender 2027&CStand: &D&RSeite &P von &N";

  const details = workbook.addWorksheet("Buchungen", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      showGridLines: false,
      printTitlesRow: "1:1",
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.25 },
    },
  });
  details.headerFooter.oddHeader = "&L&BCASA BAIA SANT'ANNA&RReservierungen und Buchungen";
  details.headerFooter.oddFooter = "&LVertraulich&CStand: &D&RSeite &P von &N";
  details.columns = [
    { header: "Status", key: "status", width: 14 },
    { header: "Anreise", key: "arrival", width: 13 },
    { header: "Abreise", key: "departure", width: 13 },
    { header: "Nächte", key: "nights", width: 10 },
    { header: "Name", key: "name", width: 28 },
    { header: "E-Mail", key: "email", width: 34 },
    { header: "Gäste", key: "guests", width: 10 },
    { header: "Nachricht", key: "message", width: 55 },
  ];
  details.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  details.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263127" } };
  details.getRow(1).alignment = { vertical: "middle" };
  details.autoFilter = { from: "A1", to: "H1" };
  for (const booking of exportedBookings) {
    const row = details.addRow({
      status: booking.status === "booked" ? "Gebucht" : "Reserviert",
      arrival: excelDate(booking.arrival),
      departure: excelDate(booking.departure),
      nights: Math.round((excelDate(booking.departure).getTime() - excelDate(booking.arrival).getTime()) / 86_400_000),
      name: booking.name,
      email: booking.email,
      guests: booking.guests,
      message: booking.message,
    });
    row.getCell("arrival").numFmt = "dd.mm.yyyy";
    row.getCell("departure").numFmt = "dd.mm.yyyy";
    applyFill(row.getCell("status"), fills[booking.status]);
    row.alignment = { vertical: "top", wrapText: true };
  }
  details.getColumn("email").eachCell((cell, rowNumber) => {
    if (rowNumber > 1 && typeof cell.value === "string") cell.value = { text: cell.value, hyperlink: `mailto:${cell.value}` };
  });

  return workbook.xlsx.writeBuffer();
}

function printableBookings(bookings: Booking[]) {
  return bookings
    .map((booking) => ({ ...booking, status: normalizedStatus(booking.status) }))
    .filter((booking): booking is Booking & { status: "reserved" | "booked" } => booking.status === "reserved" || booking.status === "booked")
    .sort((a, b) => a.arrival.localeCompare(b.arrival));
}

export function createBookingCalendarPdf(bookings: Booking[]) {
  const exportedBookings = printableBookings(bookings);
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: "Kalender 2027 – CASA BAIA SANT'ANNA", Author: "CASA BAIA SANT'ANNA" },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const result = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const page = { width: 841.89, height: 595.28, margin: 28 };
  const colors = { text: "#263127", muted: "#777A70", line: "#C9C7BD", reserved: "#FFD966", booked: "#70AD47" };
  const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const weekDays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const dateKey = (date: Date) => date.toISOString().slice(0, 10);
  const bookingForDate = (key: string) => exportedBookings.find((booking) => booking.arrival <= key && key < booking.departure);

  document.addPage({ size: "A4", layout: "landscape", margins: { top: page.margin, bottom: page.margin, left: page.margin, right: page.margin } });
  const calendarLeft = 18;
  const calendarWidth = page.width - calendarLeft * 2;
  const monthWidth = calendarWidth / 12;
  const monthHeaderY = 57;
  const monthHeaderHeight = 21;
  const dayRowHeight = 14.45;
  const dayWidths = [0.21, 0.24, 0.38, 0.17].map((ratio) => monthWidth * ratio);
  const holidays: Record<string, string> = {
    "2027-01-01": "Neujahr", "2027-01-06": "Heilige Drei Könige", "2027-02-08": "Rosenmontag",
    "2027-03-26": "Karfreitag", "2027-03-28": "Ostern", "2027-03-29": "Ostermontag",
    "2027-05-01": "Tag der Arbeit", "2027-05-06": "Christi Himmelfahrt", "2027-05-09": "Muttertag",
    "2027-05-16": "Pfingsten", "2027-05-17": "Pfingstmontag", "2027-05-27": "Fronleichnam",
    "2027-10-03": "Tag der Dt. Einheit", "2027-10-31": "Reformationstag", "2027-11-01": "Allerheiligen",
    "2027-11-28": "1. Advent", "2027-12-24": "Heiligabend", "2027-12-25": "1. Weihnachtstag",
    "2027-12-26": "2. Weihnachtstag", "2027-12-31": "Silvester",
  };
  const isoWeek = (date: Date) => {
    const thursday = new Date(date);
    thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    return Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  };

  document.fillColor(colors.text).font("Helvetica-Bold").fontSize(26).text("Kalender 2027", calendarLeft, 19);
  document.fillColor(colors.muted).font("Helvetica").fontSize(7).text("CASA BAIA SANT'ANNA", 650, 27, { width: 173, align: "right", lineBreak: false });
  for (let month = 0; month < 12; month += 1) {
    const x = calendarLeft + month * monthWidth;
    const daysInMonth = new Date(Date.UTC(2027, month + 1, 0)).getUTCDate();
    document.rect(x, monthHeaderY, monthWidth, monthHeaderHeight).lineWidth(0.45).stroke(colors.text);
    document.fillColor(colors.text).font("Helvetica-Bold").fontSize(7.4).text(monthNames[month], x + 2, monthHeaderY + 7, { width: monthWidth - 4, align: "center", lineBreak: false });
    for (let day = 1; day <= 31; day += 1) {
      const rowY = monthHeaderY + monthHeaderHeight + (day - 1) * dayRowHeight;
      if (day > daysInMonth) continue;
      const date = new Date(Date.UTC(2027, month, day));
      const key = dateKey(date);
      const booking = bookingForDate(key);
      const weekdayIndex = (date.getUTCDay() + 6) % 7;
      const isSunday = weekdayIndex === 6;
      const isSaturday = weekdayIndex === 5;
      const isHoliday = key in holidays;
      const baseFill = isHoliday ? "#FFD9D9" : isSunday ? "#FFCC99" : isSaturday ? "#F0E7F3" : "#FFFFFF";
      document.rect(x, rowY, monthWidth, dayRowHeight).fill(baseFill);
      if (booking) document.rect(x, rowY, dayWidths[0] + dayWidths[1] + dayWidths[2], dayRowHeight).fill(colors[booking.status]);
      let columnX = x;
      dayWidths.forEach((width) => {
        document.rect(columnX, rowY, width, dayRowHeight).lineWidth(0.18).stroke("#AFAFAF");
        columnX += width;
      });
      const textColor = isHoliday && !booking ? "#CC0000" : colors.text;
      document.fillColor(textColor).font(isSunday || isSaturday || isHoliday ? "Helvetica-Bold" : "Helvetica").fontSize(5.4)
        .text(String(day), x + 1, rowY + 4.2, { width: dayWidths[0] - 2, align: "center", lineBreak: false });
      document.fontSize(4.8).text(weekDays[weekdayIndex], x + dayWidths[0], rowY + 4.5, { width: dayWidths[1], align: "center", lineBreak: false });

      let info = holidays[key] ?? "";
      if (booking) {
        const monthStart = `2027-${String(month + 1).padStart(2, "0")}-01`;
        const segmentStart = booking.arrival > monthStart ? booking.arrival : monthStart;
        if (key === segmentStart) {
          info = info ? `${info} · ${booking.name}` : booking.name;
        }
      }
      if (info) {
        document.fillColor(booking ? colors.text : "#CC0000").font(booking ? "Helvetica-Bold" : "Helvetica").fontSize(3.6)
          .text(info, x + dayWidths[0] + dayWidths[1] + 1, rowY + 4.7, { width: dayWidths[2] - 2, ellipsis: true, lineBreak: false });
      }
      if (date.getUTCDay() === 1) {
        document.fillColor(colors.muted).font("Helvetica").fontSize(4)
          .text(String(isoWeek(date)), x + dayWidths[0] + dayWidths[1] + dayWidths[2], rowY + 4.8, { width: dayWidths[3], align: "center", lineBreak: false });
      }
    }
  }
  const calendarBottom = monthHeaderY + monthHeaderHeight + 31 * dayRowHeight;
  for (let month = 1; month < 12; month += 1) {
    const separatorX = calendarLeft + month * monthWidth;
    document.moveTo(separatorX, monthHeaderY).lineTo(separatorX, calendarBottom).lineWidth(0.9).stroke("#5E625C");
  }
  const legendY = 535;
  document.rect(calendarLeft, legendY, 9, 9).fill(colors.reserved);
  document.fillColor(colors.text).font("Helvetica").fontSize(5.5).text("Reserviert", calendarLeft + 13, legendY + 1.5, { lineBreak: false });
  document.rect(calendarLeft + 74, legendY, 9, 9).fill(colors.booked);
  document.fillColor(colors.text).text("Gebucht", calendarLeft + 87, legendY + 1.5, { lineBreak: false });
  document.fillColor(colors.muted).fontSize(5.5).text(`Erstellt am ${new Intl.DateTimeFormat("de-DE").format(new Date())}`, 650, legendY + 1.5, { width: 173, align: "right", lineBreak: false });

  document.addPage({ size: "A4", layout: "landscape", margins: { top: page.margin, bottom: page.margin, left: page.margin, right: page.margin } });
  document.fillColor(colors.text).font("Helvetica-Bold").fontSize(18).text("Buchungsübersicht 2027", page.margin, 28);
  document.fillColor(colors.muted).font("Helvetica").fontSize(7).text("Nur reservierte und gebuchte Aufenthalte · vertraulich", page.margin, 51);
  const columns = [
    { label: "Status", x: page.margin, width: 75 },
    { label: "Anreise", x: 108, width: 75 },
    { label: "Abreise", x: 190, width: 75 },
    { label: "Name", x: 272, width: 235 },
    { label: "Gäste", x: 514, width: 55 },
    { label: "Nächte", x: 576, width: 55 },
  ];
  let tableY = 76;
  const drawTableHeader = () => {
    document.rect(page.margin, tableY, 610, 20).fill(colors.text);
    document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7);
    columns.forEach((column) => document.text(column.label, column.x + 4, tableY + 6, { width: column.width - 8 }));
    tableY += 20;
  };
  drawTableHeader();
  for (const booking of exportedBookings) {
    if (booking.departure <= "2027-01-01" || booking.arrival >= "2028-01-01") continue;
    if (tableY > 535) {
      document.addPage({ size: "A4", layout: "landscape", margins: { top: page.margin, bottom: page.margin, left: page.margin, right: page.margin } });
      tableY = 38;
      drawTableHeader();
    }
    const nights = Math.round((excelDate(booking.departure).getTime() - excelDate(booking.arrival).getTime()) / 86_400_000);
    document.rect(page.margin, tableY, 610, 22).fill(booking.status === "booked" ? "#E1EBDD" : "#FFF4CD");
    document.fillColor(colors.text).font("Helvetica").fontSize(7);
    const values = [booking.status === "booked" ? "Gebucht" : "Reserviert", booking.arrival, booking.departure, booking.name, String(booking.guests), String(nights)];
    columns.forEach((column, index) => document.text(values[index], column.x + 4, tableY + 7, { width: column.width - 8, ellipsis: true, lineBreak: false }));
    tableY += 22;
  }
  if (!exportedBookings.some((booking) => booking.departure > "2027-01-01" && booking.arrival < "2028-01-01")) {
    document.fillColor(colors.muted).font("Helvetica").fontSize(9).text("Für 2027 sind keine reservierten oder gebuchten Aufenthalte vorhanden.", page.margin + 5, tableY + 14);
  }
  document.end();
  return result;
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

app.get("/api/pricing", async (_request, response, next) => {
  try {
    response.json(await readPricing());
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

app.put("/api/admin/pricing", async (request, response, next) => {
  try {
    const pricing = pricingFields(request.body as Record<string, unknown>);
    if (!pricing) {
      response.status(400).json({ message: "Alle Saisonpreise müssen ganze Eurobeträge zwischen 1 und 10.000 sein." });
      return;
    }
    await savePricing(pricing);
    response.json(pricing);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/bookings", async (_request, response, next) => {
  try {
    const bookings = await readBookings();
    response.json(bookings.map((booking) => ({ ...booking, status: normalizedStatus(booking.status) })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/bookings/export.xlsx", async (_request, response, next) => {
  try {
    const file = await createBookingCalendar(await readBookings());
    response.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=kalender-2027-buchungen.xlsx",
      "Cache-Control": "no-store",
    });
    response.send(Buffer.from(file));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/bookings/export.pdf", async (_request, response, next) => {
  try {
    const file = await createBookingCalendarPdf(await readBookings());
    response.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=kalender-2027-buchungen.pdf",
      "Cache-Control": "no-store",
    });
    response.send(file);
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
