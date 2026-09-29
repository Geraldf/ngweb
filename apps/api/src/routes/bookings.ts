import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readJSON, writeJSON, withLock } from "../lib/storage.js";
import { rateLimit } from "../lib/rateLimit.js";
import { sendEmail, buildBookingConfirmationEmail, buildAdminNotificationEmail, getAdminEmail } from "../lib/smtp2go.js";
import type { Booking, BookingFields } from "../types.js";

/**
 * Minimal booking length in nights enforced for all new submissions.
 *
 * Public booking requests are unauthenticated — this floor keeps the calendar
 * data file free of absurdly short spam entries and matches the house policy
 * (Casa Baia Sant'Anna requires a 10-night minimum stay).
 */
const MINIMUM_STAY_NIGHTS = 10;

/**
 * Rate limiter for the public POST /bookings endpoint.
 *
 * Unauthenticated submissions are throttled per client IP to 30 requests per
 * 60 seconds. Exceeding the cap returns 429 with a Retry-After header of one
 * hour. The limit protects the JSON data file from automated spam.
 */
const bookingRequestLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

/**
 * Express router that handles public booking requests.
 *
 * ## Endpoints
 *
 * - `GET /` — returns a summarised list of all bookings (arrival, departure,
 *   status only). Used by the public calendar on the website.
 * - `POST /` — accepts a new booking request, validates it, persists it to
 *   the JSON data file, and fires confirmation + admin notification emails
 *   via SMTP2GO (fire-and-forget).
 *
 * ## Data file
 *
 * The `dataFile` argument is a path to a JSON file that holds the full
 * booking array. All reads and writes are wrapped in `withLock()` to prevent
 * concurrent corruption when the API restarts or multiple requests land
 * simultaneously.
 *
 * ## Email notifications
 *
 * After a successful POST, two emails are sent asynchronously:
 *   1. Confirmation to the guest (`booking.email`) via `buildBookingConfirmationEmail()`.
 *   2. Admin notification to `BOOKING_ADMIN_EMAIL` (default:
 *      `info@casa-baia-sant-anna.com`) via `buildAdminNotificationEmail()`.
 *
 * Email failures are logged to console.error but never affect the HTTP
 * response — the booking is committed before any email is sent.
 *
 * ## Status lifecycle
 *
 * Submissions always land as `"requested"`. The admin router
 * (`routes/admin.ts`) can later promote them to `"reserved"` or `"booked"`.
 *
 * ## Environment variables (consumed via smtp2go.ts)
 *
 * - `SMTP2GO_API_KEY` — API key (prefix `api-`), required for any email.
 * - `BOOKING_CONFIRMATION_FROM` — sender address for guest confirmations.
 * - `BOOKING_ADMIN_EMAIL` — admin notification recipient (defaults to
 *   `info@casa-baia-sant-anna.com`). Leave empty to disable admin emails
 *   while keeping guest confirmations.
 */
export function createBookingRouter(dataFile: string): Router {
  const router = Router();

  /**
   * Returns true when `fields` overlaps an existing non-requested booking.
   *
   * Request-status bookings are excluded from the overlap check because they
   * are not yet confirmed — they don't block the calendar. The optional
   * `ignoredId` allows updates (used by the admin router) without colliding
   * with the booking being edited.
   */
  function overlapsBooking(
    bookings: Booking[],
    fields: BookingFields,
    ignoredId?: string
  ) {
    return bookings.some(
      (b) =>
        b.id !== ignoredId &&
        b.status !== "requested" &&
        fields.arrival < b.departure &&
        fields.departure > b.arrival
    );
  }

  /**
   * Normalise a stored status value for public consumption.
   *
   * Unknown or missing statuses fall back to `"reserved"`. This keeps the
   * public calendar predictable even if a migration or manual edit leaves a
   * booking without a recognised status.
   */
  function normalizedStatus(status: Booking["status"]): NonNullable<Booking["status"]> {
    return status === "booked" || status === "requested" ? status : "reserved";
  }

  /**
   * Parse and validate a booking submission body.
   *
   * Returns `undefined` when validation fails — the caller is expected to
   * respond with 400. On success, returns a `BookingFields` object suitable
   * for persistence.
   *
   * ## Validation rules
   *
   * - `arrival` / `departure` must be parseable ISO dates, `departure` after
   *   `arrival`, and the stay must be at least `MINIMUM_STAY_NIGHTS` nights.
   * - `name` must be a non-empty string, truncated to 120 chars.
   * - `email` must be a non-empty string containing `@`, truncated to 200 chars.
   * - `guests` must be an integer between 1 and 4 inclusive.
   * - `message` is optional; if present it is trimmed and capped at 2000 chars.
   * - Submitted statuses other than `"booked"`/`"reserved"` are coerced to
   *   `"requested"`.
   */
  function bookingFields(
    body: Record<string, unknown>
  ): BookingFields | undefined {
    const arrival = typeof body.arrival === "string" ? body.arrival : "";
    const departure = typeof body.departure === "string" ? body.departure : "";
    const start = new Date(`${arrival}T00:00:00Z`);
    const end = new Date(`${departure}T00:00:00Z`);
    const stayNights = (end.getTime() - start.getTime()) / 86_400_000;
    const guests = Number(body.guests);
    const status =
      body.status === "booked" || body.status === "reserved"
        ? body.status
        : "requested";

    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      stayNights < MINIMUM_STAY_NIGHTS ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      typeof body.email !== "string" ||
      !body.email.includes("@") ||
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > 4
    )
      return undefined;

    return {
      arrival,
      departure,
      status,
      name: body.name.trim().slice(0, 120),
      email: body.email.trim().slice(0, 200),
      guests,
      message:
        typeof body.message === "string"
          ? body.message.trim().slice(0, 2000)
          : "",
    };
  }

  /**
   * `GET /` — return a summarised booking list.
   *
   * Responds with an array of `{ arrival, departure, status }` objects. The
   * full booking details (name, email, guests, message) are not exposed here
   * because this endpoint is public and unauthenticated.
   */
  router.get("/", async (_request, response, next) => {
    try {
      const bookings = await readJSON<Booking[]>(dataFile, []);
      response.json(
        bookings.map(({ arrival, departure, status }) => ({
          arrival,
          departure,
          status: normalizedStatus(status),
        }))
      );
    } catch (error) {
      next(error);
    }
  });

  /**
   * `POST /` — accept a new booking request.
   *
   * ### Middleware pipeline
   *
   * 1. Rate limit check — returns 429 if the client IP exceeded the cap.
   * 2. Body validation via `bookingFields()` — returns 400 on invalid input.
   * 3. Overlap check inside a file lock — returns 409 if the period is taken.
   * 4. Persistence + fire-and-forget emails — returns 201 on success.
   *
   * ### Response shapes
   *
   * - `201 { id: string, message: string }` — booking created.
   * - `400 { message: string }` — validation failed.
   * - `409 { message: string }` — period no longer available.
   * - `429 { message: string }` — rate limit exceeded (Retry-After: 3600).
   */
  router.post(
    "/",
    (request, response, next) => {
      if (
        bookingRequestLimiter(
          request.ip ?? request.socket.remoteAddress ?? "unknown"
        )
      ) {
        response.set("Retry-After", "3600");
        response.status(429).json({
          message:
            "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
        });
        return;
      }
      next();
    },
    async (request, response, next) => {
      try {
        const fields = bookingFields({
          ...request.body,
          status: "requested",
        });

        if (!fields) {
          response.status(400).json({
            message: "Bitte prüfen Sie Ihre Reisedaten und Kontaktdaten.",
          });
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
          response.status(409).json({
            message: "Dieser Zeitraum ist leider nicht mehr verfügbar.",
          });
          return;
        }

        // Fire-and-forget: send confirmation + admin notification via SMTP2GO.
        // Failures are logged but do not affect the HTTP response.
        const { subject, textBody, htmlBody } = buildBookingConfirmationEmail(
          booking,
          "de"
        );
        sendEmail({
          to: [booking.email],
          subject,
          textBody,
          htmlBody,
        }).then(
          (result) => {
            if (!result.success) {
              console.error(
                `[bookings] confirmation email failed for ${booking.id}:`,
                result.error
              );
            }
          },
          (err) => {
            console.error(
              `[bookings] confirmation email threw for ${booking.id}:`,
              err instanceof Error ? err.message : err
            );
          }
        );

        // Admin notification — separate email to BOOKING_ADMIN_EMAIL.
        const adminEmail = getAdminEmail();
        const { subject: adminSubject, textBody: adminText, htmlBody: adminHtml } =
          buildAdminNotificationEmail(booking);
        sendEmail({
          to: [adminEmail],
          subject: adminSubject,
          textBody: adminText,
          htmlBody: adminHtml,
        }).then(
          (result) => {
            if (!result.success) {
              console.error(
                `[bookings] admin notification failed for ${booking.id} → ${adminEmail}:`,
                result.error
              );
            }
          },
          (err) => {
            console.error(
              `[bookings] admin notification threw for ${booking.id}:`,
              err instanceof Error ? err.message : err
            );
          }
        );

        response.status(201).json({
          id: booking.id,
          message: "Ihre Buchungsanfrage ist bei uns eingegangen.",
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
