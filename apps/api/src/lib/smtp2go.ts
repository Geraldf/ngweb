/**
 * SMTP2GO API v3 email sender.
 *
 * Required environment variables:
 *   SMTP2GO_API_KEY         — API key (prefix "api-")
 *   BOOKING_CONFIRMATION_FROM — sender address, e.g. bookings@casa-baia-sant-anna.com
 */

export async function sendEmail({
  to,
  subject,
  textBody,
  htmlBody,
}: {
  to: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.SMTP2GO_API_KEY;
  const from = process.env.BOOKING_CONFIRMATION_FROM;

  if (!apiKey) {
    return { success: false, error: "SMTP2GO_API_KEY not configured" };
  }
  if (!from) {
    return { success: false, error: "BOOKING_CONFIRMATION_FROM not configured" };
  }

  const payload: Record<string, unknown> = {
    sender: from,
    to,
    subject,
    text_body: textBody,
  };

  if (htmlBody) {
    payload.html_body = htmlBody;
  }

  let response: Response;
  try {
    response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": apiKey,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "failed to reach smtp2go API",
    };
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      // ignore — fall back to statusText
    }
    return { success: false, error: `smtp2go ${response.status}: ${detail}` };
  }

  let ids: string[] = [];
  try {
    const json = (await response.json()) as { result?: { ids?: string[] } };
    ids = json.result?.ids ?? [];
  } catch {
    // non-critical — email likely sent anyway
  }

  return { success: true, messageId: ids[0] };
}

export interface BookingConfirmationData {
  id: string;
  name: string;
  email: string;
  arrival: string;
  departure: string;
  guests: number;
  message: string;
  createdAt: string;
}

export function buildBookingConfirmationEmail(
  b: BookingConfirmationData,
  lang: "de" | "en" = "de"
): { subject: string; textBody: string; htmlBody: string } {
  const de = lang === "de";

  const subject = de
    ? `Buchungsanfrage #${b.id.slice(0, 8)} — Casa Baia Sant'Anna`
    : `Booking request #${b.id.slice(0, 8)} — Casa Baia Sant'Anna`;

  const textBody = [
    (de ? `Sehr geehrte(r) ${b.name},` : `Dear ${b.name},`),
    "",
    de
      ? "vielen Dank für Ihre Buchungsanfrage. Wir haben Ihre Anfrage erhalten und melden uns in Kürze bei Ihnen."
      : "thank you for your booking request. We have received it and will get back to you soon.",
    "",
    "---",
    "",
    `${de ? "Anfrage-Details" : "Request details"}:`,
    `Ref: ${b.id}`,
    `Name: ${b.name}`,
    `${de ? "E-Mail" : "Email"}: ${b.email}`,
    `${de ? "Ankunft" : "Arrival"}: ${b.arrival}`,
    `${de ? "Abreise" : "Departure"}: ${b.departure}`,
    `${de ? "Gäste" : "Guests"}: ${b.guests}`,
    `${de ? "Gesendet" : "Sent"}: ${new Date(b.createdAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
    b.message ? `\n${de ? "Ihre Nachricht" : "Your message"}:\n${b.message}` : "",
  ].join("\n");

  const htmlBody = `<!DOCTYPE html>
<html lang="${de ? "de" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: #2c5f2d; color: white; padding: 20px; border-radius: 8px 8px 0 0; margin-bottom: 20px; }
  .header h1 { margin: 0; font-size: 1.4rem; }
  .details { background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; }
  .details table { width: 100%; border-collapse: collapse; }
  .details td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  .details td:last-child { font-weight: 600; }
  .footer { font-size: 0.85rem; color: #888; margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee; }
</style>
</head>
<body>
<div class="header"><h1>${de ? "Buchungsanfrage erhalten" : "Booking request received"}</h1></div>
<p>${de ? "Sehr geehrte(r)" : "Dear"} <strong>${b.name}</strong>,</p>
<p>${de ? "vielen Dank für Ihre Buchungsanfrage. Wir haben Ihre Anfrage erhalten und melden uns in Kürze bei Ihnen." : "thank you for your booking request. We have received it and will get back to you soon."}</p>
<div class="details">
  <table>
    <tr><td>Ref</td><td><code>${b.id}</code></td></tr>
    <tr><td>${de ? "Ankunft" : "Arrival"}</td><td>${b.arrival}</td></tr>
    <tr><td>${de ? "Abreise" : "Departure"}</td><td>${b.departure}</td></tr>
    <tr><td>${de ? "Gäste" : "Guests"}</td><td>${b.guests}</td></tr>
    <tr><td>${de ? "Gesendet" : "Sent"}</td><td>${new Date(b.createdAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td></tr>
    ${b.message ? `<tr><td>${de ? "Ihre Nachricht" : "Your message"}</td><td>${b.message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td></tr>` : ""}
  </table>
</div>
<div class="footer">Casa Baia Sant'Anna — ${de ? "Wir freuen uns auf Ihren Aufenthalt!" : "We look forward to your stay!"}</div>
</body>
</html>`.trim();

  return { subject, textBody, htmlBody };
}
