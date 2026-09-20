import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import path from "node:path";
import { readJSON } from "../lib/storage.js";
import { requireAdmin } from "../middleware/admin.js";
import type { Booking, Pricing } from "../types.js";

const MINIMUM_STAY_NIGHTS = 10;

function excelDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoWeek(date: Date) {
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function calendarHolidays(year: number) {
  const holidays = new Map<string, string>();
  const add = (date: Date, label: string) => holidays.set(date.toISOString().slice(0, 10), label);
  const fixed = (month: number, day: number, label: string) => add(new Date(Date.UTC(year, month - 1, day)), label);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, easterMonth - 1, easterDay));
  const relative = (days: number, label: string) => {
    const date = new Date(easter);
    date.setUTCDate(date.getUTCDate() + days);
    add(date, label);
  };
  fixed(1, 1, "Neujahr"); fixed(1, 6, "Heilige Drei Könige"); fixed(5, 1, "Tag der Arbeit");
  fixed(10, 3, "Tag der Dt. Einheit"); fixed(10, 31, "Reformationstag"); fixed(11, 1, "Allerheiligen");
  fixed(12, 24, "Heiligabend"); fixed(12, 25, "1. Weihnachtstag"); fixed(12, 26, "2. Weihnachtstag"); fixed(12, 31, "Silvester");
  relative(-48, "Rosenmontag"); relative(-2, "Karfreitag"); relative(0, "Ostern"); relative(1, "Ostermontag");
  relative(39, "Christi Himmelfahrt"); relative(49, "Pfingsten"); relative(50, "Pfingstmontag"); relative(60, "Fronleichnam");
  const mothersDay = new Date(Date.UTC(year, 4, 8));
  mothersDay.setUTCDate(mothersDay.getUTCDate() + ((7 - mothersDay.getUTCDay()) % 7));
  add(mothersDay, "Muttertag");
  const firstAdvent = new Date(Date.UTC(year, 10, 27));
  firstAdvent.setUTCDate(firstAdvent.getUTCDate() + ((7 - firstAdvent.getUTCDay()) % 7));
  add(firstAdvent, "1. Advent");
  return holidays;
}

function calendarExportYear(value: unknown) {
  const year = Number(value ?? 2027);
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : undefined;
}

function normalizedStatus(status: Booking["status"]): NonNullable<Booking["status"]> {
  return status === "booked" || status === "requested" ? status : "reserved";
}

function printableBookings(bookings: Booking[], year: number) {
  return bookings
    .map((booking) => ({ ...booking, status: normalizedStatus(booking.status) }))
    .filter((booking): booking is Booking & { status: "reserved" | "booked" } => booking.status === "reserved" || booking.status === "booked")
    .filter((booking) => booking.departure > `${year}-01-01` && booking.arrival < `${year + 1}-01-01`)
    .sort((a, b) => a.arrival.localeCompare(b.arrival));
}

export async function createBookingCalendar(bookings: Booking[], year: number, templatePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const calendar = workbook.getWorksheet("Kalender-2027");
  if (!calendar) throw new Error("Das Kalenderblatt der Excel-Vorlage fehlt.");
  const weekdayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const holidays = calendarHolidays(year);
  const sourceStyles = {
    weekdayDay: structuredClone(calendar.getCell("A6").style), weekdayName: structuredClone(calendar.getCell("B6").style),
    saturdayDay: structuredClone(calendar.getCell("A4").style), saturdayName: structuredClone(calendar.getCell("B4").style),
    sundayDay: structuredClone(calendar.getCell("A5").style), sundayName: structuredClone(calendar.getCell("B5").style),
    holidayDay: structuredClone(calendar.getCell("A3").style), holidayName: structuredClone(calendar.getCell("B3").style),
    info: structuredClone(calendar.getCell("C6").style), holidayInfo: structuredClone(calendar.getCell("C3").style),
    week: structuredClone(calendar.getCell("D6").style),
  };
  for (const range of [...calendar.model.merges]) {
    const startRow = Number(range.match(/\d+/)?.[0] ?? 0);
    if (startRow >= 3 && startRow <= 33) calendar.unMergeCells(range);
  }
  calendar.name = `Kalender ${year}`;
  calendar.getCell("A1").value = `Kalender ${year}`;
  for (let month = 0; month < 12; month += 1) {
    const firstColumn = month * 4 + 1;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= 31; day += 1) {
      const cells = [0, 1, 2, 3].map((offset) => calendar.getCell(day + 2, firstColumn + offset));
      if (day > daysInMonth) {
        cells.forEach((cell) => { cell.value = null; cell.style = {}; });
        continue;
      }
      const date = new Date(Date.UTC(year, month, day));
      const key = date.toISOString().slice(0, 10);
      const holiday = holidays.get(key);
      const weekday = date.getUTCDay();
      cells[0].value = day;
      cells[1].value = weekdayNames[weekday];
      cells[2].value = holiday ?? null;
      cells[3].value = weekday === 1 ? isoWeek(date) : null;
      cells[0].style = structuredClone(holiday ? sourceStyles.holidayDay : weekday === 6 ? sourceStyles.saturdayDay : weekday === 0 ? sourceStyles.sundayDay : sourceStyles.weekdayDay);
      cells[1].style = structuredClone(holiday ? sourceStyles.holidayName : weekday === 6 ? sourceStyles.saturdayName : weekday === 0 ? sourceStyles.sundayName : sourceStyles.weekdayName);
      cells[2].style = structuredClone(holiday ? sourceStyles.holidayInfo : sourceStyles.info);
      cells[3].style = structuredClone(sourceStyles.week);
    }
  }

  const exportedBookings = printableBookings(bookings, year);
  const fills = {
    reserved: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } },
    booked: { type: "pattern", pattern: "solid", fgColor: { argb: "FF70AD47" } },
  } satisfies Record<"reserved" | "booked", ExcelJS.Fill>;
  const applyFill = (cell: ExcelJS.Cell, fill: ExcelJS.Fill) => {
    cell.style = { ...cell.style, fill };
  };

  for (const booking of exportedBookings) {
    const start = excelDate(booking.arrival);
    const end = excelDate(booking.departure);
    const firstVisibleNight = Math.max(start.getTime(), Date.UTC(year, 0, 1));
    for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
      if (date.getUTCFullYear() !== year) continue;
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
  calendar.headerFooter.oddFooter = `&LKalender ${year}&CStand: &D&RSeite &P von &N`;

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

export function createBookingCalendarPdf(bookings: Booking[], year = 2027) {
  const exportedBookings = printableBookings(bookings, year);
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: `Kalender ${year} – CASA BAIA SANT'ANNA`, Author: "CASA BAIA SANT'ANNA" },
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
  const holidays = calendarHolidays(year);

  document.fillColor(colors.text).font("Helvetica-Bold").fontSize(26).text(`Kalender ${year}`, calendarLeft, 19);
  document.fillColor(colors.muted).font("Helvetica").fontSize(7).text("CASA BAIA SANT'ANNA", 650, 27, { width: 173, align: "right", lineBreak: false });
  for (let month = 0; month < 12; month += 1) {
    const x = calendarLeft + month * monthWidth;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    document.rect(x, monthHeaderY, monthWidth, monthHeaderHeight).lineWidth(0.45).stroke(colors.text);
    document.fillColor(colors.text).font("Helvetica-Bold").fontSize(7.4).text(monthNames[month], x + 2, monthHeaderY + 7, { width: monthWidth - 4, align: "center", lineBreak: false });
    for (let day = 1; day <= 31; day += 1) {
      const rowY = monthHeaderY + monthHeaderHeight + (day - 1) * dayRowHeight;
      if (day > daysInMonth) continue;
      const date = new Date(Date.UTC(year, month, day));
      const key = dateKey(date);
      const booking = bookingForDate(key);
      const weekdayIndex = (date.getUTCDay() + 6) % 7;
      const isSunday = weekdayIndex === 6;
      const isSaturday = weekdayIndex === 5;
      const isHoliday = holidays.has(key);
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

      let info = holidays.get(key) ?? "";
      if (booking) {
        const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
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
  document.fillColor(colors.text).font("Helvetica-Bold").fontSize(18).text(`Buchungsübersicht ${year}`, page.margin, 28);
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
  if (exportedBookings.length === 0) {
    document.fillColor(colors.muted).font("Helvetica").fontSize(9).text(`Für ${year} sind keine reservierten oder gebuchten Aufenthalte vorhanden.`, page.margin + 5, tableY + 14);
  }
  document.end();
  return result;
}

export function createCalendarRouter(bookingsFile: string, templatePath: string): Router {
  const router = Router();

  router.get("/bookings/export.xlsx", requireAdmin, async (request, response, next) => {
    try {
      const year = calendarExportYear(request.query.year);
      if (!year) {
        response.status(400).json({ message: "Bitte wählen Sie ein Kalenderjahr zwischen 2020 und 2100." });
        return;
      }
      const bookings = await readJSON<Booking[]>(bookingsFile, []);
      const file = await createBookingCalendar(bookings, year, templatePath);
      response.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=kalender-${year}-buchungen.xlsx`,
        "Cache-Control": "no-store",
      });
      response.send(Buffer.from(file));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bookings/export.pdf", requireAdmin, async (request, response, next) => {
    try {
      const year = calendarExportYear(request.query.year);
      if (!year) {
        response.status(400).json({ message: "Bitte wählen Sie ein Kalenderjahr zwischen 2020 und 2100." });
        return;
      }
      const bookings = await readJSON<Booking[]>(bookingsFile, []);
      const file = await createBookingCalendarPdf(bookings, year);
      response.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=kalender-${year}-buchungen.pdf`,
        "Cache-Control": "no-store",
      });
      response.send(file);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
