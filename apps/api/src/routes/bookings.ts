import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readJSON, writeJSON, withLock } from "../lib/storage.js";
import type { Booking, BookingFields } from "../types.js";

const MINIMUM_STAY_NIGHTS = 10;

export function createBookingRouter(dataFile: string): Router {
  const router = Router();

  function overlapsBooking(bookings: Booking[], fields: BookingFields, ignoredId?: string) {
    return bookings.some((booking) => booking.id !== ignoredId && booking.status !== "requested" && fields.arrival < booking.departure && fields.departure > booking.arrival);
  }

  function normalizedStatus(status: Booking["status"]): NonNullable<Booking["status"]> {
    return status === "booked" || status === "requested" ? status : "reserved";
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

  router.get("/", async (_request, response, next) => {
    try {
      const bookings = await readJSON<Booking[]>(dataFile, []);
      response.json(bookings.map(({ arrival, departure, status }) => ({
        arrival,
        departure,
        status: normalizedStatus(status),
      })));
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const fields = bookingFields({ ...(request.body as Record<string, unknown>), status: "requested" });
      if (!fields) {
        response.status(400).json({ message: "Bitte prüfen Sie Ihre Reisedaten und Kontaktdaten." });
        return;
      }
      const booking = await withLock(dataFile, async () => {
        const bookings = await readJSON<Booking[]>(dataFile, []);
        if (overlapsBooking(bookings, fields)) {
          return null;
        }
        const newBooking: Booking = {
          id: randomUUID(),
          ...fields,
          createdAt: new Date().toISOString(),
        };
        await writeJSON(dataFile, [...bookings, newBooking]);
        return newBooking;
      });
      if (!booking) {
        response.status(409).json({ message: "Dieser Zeitraum ist leider nicht mehr verfügbar." });
        return;
      }
      response.status(201).json({ id: booking.id, message: "Ihre Buchungsanfrage ist bei uns eingegangen." });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
