import { StrictMode, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/italiana/latin-400.css";
import webPackage from "../package.json";

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 269 105" aria-hidden="true">
      <path d="M8 14c18 5 35 14 53 17 15 2 27-5 45-22 28 21 49 34 71 35 22 1 39-10 61-28 8-6 17 1 27 20" />
      <path d="M5 79c24 7 47 5 77-13 25 13 42 25 60 25 19 0 35-11 57-22 16-4 26 19 42 26 6 3 12 3 19 3" />
    </svg>
  );
}
import ausstattungImage from "./assets/Ausstattung.jpg";
import badezimmerImage from "./assets/BadeZimmer.jpeg";
import locationMapImage from "./assets/casa-location-map.png";
import heroImage from "./assets/frontimage.jpg";
import gartenImage from "./assets/Garten.jpg";
import kinderzimmerImage from "./assets/Kinderzimmer.jpg";
import schlafzimmerImage from "./assets/Schlafzimmer.jpg";
import terrasseImage from "./assets/Terassse.jpg";
import wohnenKuecheImage from "./assets/Wohnen_Kueche.jpg";
import "./styles.css";

const links = ["Home", "La Casa", "Galerie", "Lage & Infos", "Preise & Kalender"];
const menuTargets = ["home", "casa", "galerie", "lage", "preise"] as const;
const googleMapsUrl = "https://www.google.de/maps/place/CASA+BAIA+SANT+ANNA/@40.6855298,9.7358159,748m/data=!3m2!1e3!4b1!4m6!3m5!1s0x12dedb92f8b8838d:0xe5e1f73dbbd3b38d!8m2!3d40.6855258!4d9.7383962!16s%2Fg%2F11yk4ddk7c";
const destinations = [
  ["Budoni", "5 Min."],
  ["Porto Ottiolu", "10 Min."],
  ["Posada", "10 Min."],
  ["San Teodoro", "15 Min."],
  ["La Caletta", "15 Min."],
  ["Santa Lucia", "20 Min."],
  ["Olbia · Hafen & Flughafen", "35 Min."],
  ["Orosei", "40 Min."],
  ["Cala Gonone", "60 Min."],
] as const;
const activities = ["Schwimmen", "SUP", "Surfen & Kitesurfen", "Tauchen", "Reiten", "Wandern", "Radfahren", "Yoga", "Bootstouren", "Schnorcheln", "Naturparks", "Wasserfälle", "Weingüter", "Klettern", "Segeln", "Golf"];
type MediaItem = { id: string; filename: string; title: string; mimeType: string; placement: "library" | "gallery"; order: number; createdAt: string };
type GalleryPhoto = { id: string; src: string; title: string; position?: string; className?: string };
type BookingStatus = "requested" | "reserved" | "booked";
type BookingRange = { arrival: string; departure: string; status: BookingStatus };
type Pricing = { lowSeason: number; midSeason: number; highSeason: number };
type AdminBooking = BookingRange & { id: string; name: string; email: string; guests: number; message: string; createdAt: string };
type BookingDebugEntry = { id: string; timestamp: string; operation: string; status: number | "network"; message: string };

const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const monthFormatter = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const fullDateFormatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function bookingStatusLabel(status: BookingStatus) {
  return status === "booked" ? "Gebucht" : status === "reserved" ? "Reserviert" : "Angefragt";
}

function highestPriorityBooking(bookings: BookingRange[]) {
  return bookings.sort((a, b) => ["requested", "reserved", "booked"].indexOf(b.status) - ["requested", "reserved", "booked"].indexOf(a.status))[0];
}

function BookingMonth({ month, bookings }: { month: Date; bookings: BookingRange[] }) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const leadingDays = (month.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = Array.from({ length: leadingDays + daysInMonth }, (_, index) => index < leadingDays ? null : index - leadingDays + 1);

  return <article className="booking-month">
    <h4>{monthFormatter.format(month)}</h4>
    <div className="calendar-grid" role="grid" aria-label={monthFormatter.format(month)}>
      {dayNames.map((day) => <span className="calendar-weekday" role="columnheader" key={day}>{day}</span>)}
      {cells.map((day, index) => {
        if (day === null) return <span className="calendar-day is-empty" aria-hidden="true" key={`empty-${index}`} />;
        const date = new Date(Date.UTC(year, monthIndex, day));
        const dateKey = isoDate(date);
        const unavailableBookings = bookings.filter((booking) => booking.status !== "requested");
        const occupied = highestPriorityBooking(unavailableBookings.filter((booking) => booking.arrival < dateKey && dateKey < booking.departure));
        const arriving = highestPriorityBooking(unavailableBookings.filter((booking) => booking.arrival === dateKey));
        const departing = highestPriorityBooking(unavailableBookings.filter((booking) => booking.departure === dateKey));
        const statusLabel = occupied || arriving || departing ? "Nicht verfügbar" : "Verfügbar";
        return <span className={`calendar-day${occupied ? " is-unavailable" : ""}`} role="gridcell" aria-label={`${fullDateFormatter.format(date)}: ${statusLabel}`} key={dateKey}>
          {departing && <i className="calendar-departure is-unavailable" aria-hidden="true" />}
          {arriving && <i className="calendar-arrival is-unavailable" aria-hidden="true" />}
          <time dateTime={dateKey}>{day}</time>
        </span>;
      })}
    </div>
  </article>;
}

const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const adminRequestTimeoutMs = 10_000;
const migrationImportTimeoutMs = 10 * 60_000;
const minimumStayNights = 10;
const cleaningFee = 150;
const laundryFeePerGuest = 25;
const defaultPricing: Pricing = { lowSeason: 120, midSeason: 160, highSeason: 210 };

function trackEvent(name: string, detail: Record<string, string | number> = {}) {
  window.dispatchEvent(new CustomEvent("casa:analytics", { detail: { name, ...detail } }));
}

function nightlyRate(date: Date, pricing: Pricing) {
  const month = date.getUTCMonth();
  return month <= 2 || month === 10 || month === 11 ? pricing.lowSeason : month <= 5 || month === 9 ? pricing.midSeason : pricing.highSeason;
}

function App() {
  const isImpressum = window.location.pathname.replace(/\/$/, "") === "/impressum";
  const isDatenschutz = window.location.pathname.replace(/\/$/, "") === "/datenschutz";
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState<number | null>(null);
  const [portraitPhotoIds, setPortraitPhotoIds] = useState<Set<string>>(() => new Set());
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerSection, setManagerSection] = useState<"images" | "bookings" | "pricing" | "migration">("images");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [bookings, setBookings] = useState<BookingRange[]>([]);
  const [bookingStatus, setBookingStatus] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [guests, setGuests] = useState(2);
  const [bookingErrors, setBookingErrors] = useState<{ arrival?: string; departure?: string }>({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });
  const [adminToken, setAdminToken] = useState("");
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminBookings, setAdminBookings] = useState<AdminBooking[]>([]);
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState("");
  const [pricing, setPricing] = useState<Pricing>(defaultPricing);
  const [pricingDraft, setPricingDraft] = useState<Pricing>(defaultPricing);
  const [pricingStatus, setPricingStatus] = useState("");
  const [bookingDebug, setBookingDebug] = useState(false);
  const [bookingDebugEntries, setBookingDebugEntries] = useState<BookingDebugEntry[]>([]);

  const gallery = useMemo<GalleryPhoto[]>(() =>
    media.filter((item) => item.placement === "gallery").sort((a, b) => a.order - b.order).map((item) => ({
      id: item.id,
      src: `${apiBase}/uploads/${item.filename}`,
      title: item.title,
    })), [media]);
  const sortedMedia = useMemo(() => [...media].sort((a, b) => a.order - b.order), [media]);
  const activeBookings = useMemo(() => {
    const today = isoDate(new Date());
    return bookings.filter((booking) => booking.departure > today);
  }, [bookings]);
  const visibleMonths = useMemo(() => [calendarMonth, new Date(Date.UTC(calendarMonth.getUTCFullYear(), calendarMonth.getUTCMonth() + 1, 1))], [calendarMonth]);
  const priceSummary = useMemo(() => {
    if (!arrival || !departure) return undefined;
    const start = new Date(`${arrival}T00:00:00Z`);
    const end = new Date(`${departure}T00:00:00Z`);
    if (!Number.isFinite(start.getTime()) || end <= start) return undefined;
    let nights = 0;
    let accommodation = 0;
    for (const date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
      nights += 1;
      accommodation += nightlyRate(date, pricing);
    }
    const laundry = guests * laundryFeePerGuest;
    return { nights, accommodation, laundry, total: accommodation + cleaningFee + laundry };
  }, [arrival, departure, guests, pricing]);
  const minimumDeparture = useMemo(() => {
    if (!arrival) return "";
    const date = new Date(`${arrival}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + minimumStayNights);
    return isoDate(date);
  }, [arrival]);

  const loadMedia = async () => {
    try {
      const response = await fetch(`${apiBase}/api/media`);
      if (!response.ok) throw new Error("Die Bildbibliothek ist gerade nicht erreichbar.");
      setMedia(await response.json() as MediaItem[]);
      setMediaError("");
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Die Bildbibliothek ist gerade nicht erreichbar.");
    }
  };

  const loadPublicBookings = async () => {
    try {
      const response = await fetch(`${apiBase}/api/bookings`);
      setBookings(response.ok ? await response.json() as BookingRange[] : []);
    } catch {
      setBookings([]);
    }
  };

  const loadPricing = async () => {
    try {
      const response = await fetch(`${apiBase}/api/pricing`);
      if (!response.ok) throw new Error("Preise konnten nicht geladen werden.");
      const result = await response.json() as Pricing;
      setPricing(result);
      setPricingDraft(result);
    } catch {
      setPricing(defaultPricing);
      setPricingDraft(defaultPricing);
    }
  };

  const authenticatedRequest = async (url: string, init: RequestInit = {}) => {
    try {
      return await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${adminToken}`, ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(adminRequestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("Der Server antwortet nicht. Bitte versuchen Sie es erneut.");
      }
      throw error;
    }
  };

  const adminRequest = async (path = "", init: RequestInit = {}) => {
    const operation = `${init.method ?? "GET"} /api/admin/bookings${path}`;
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/bookings${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
      if (bookingDebug) {
        let message = response.ok ? "Anfrage erfolgreich" : response.statusText || "Anfrage fehlgeschlagen";
        try {
          const diagnostic = await response.clone().json() as { message?: string };
          if (diagnostic.message) message = diagnostic.message;
        } catch { /* Responses without JSON do not need additional diagnostics. */ }
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toLocaleTimeString("de-DE"), operation, status: response.status, message } satisfies BookingDebugEntry;
        setBookingDebugEntries((current) => [entry, ...current].slice(0, 20));
        console.info("[booking-debug]", entry);
      }
      return response;
    } catch (error) {
      if (bookingDebug) {
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toLocaleTimeString("de-DE"), operation, status: "network", message: error instanceof Error ? error.message : "Netzwerkfehler" } satisfies BookingDebugEntry;
        setBookingDebugEntries((current) => [entry, ...current].slice(0, 20));
        console.error("[booking-debug]", entry);
      }
      throw error;
    }
  };

  const authenticateAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/session`);
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        throw new Error(result.message ?? "Anmeldung fehlgeschlagen.");
      }
      setAdminAuthenticated(true);
      await Promise.all([loadAdminBookings(), loadPricing()]);
    } catch (error) {
      setAdminAuthenticated(false);
      setAdminError(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setAdminBusy(false);
    }
  };

  const loadAdminBookings = async () => {
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await adminRequest();
      const result = await response.json() as AdminBooking[] | { message?: string };
      if (!response.ok) throw new Error("message" in result ? result.message : "Buchungen konnten nicht geladen werden.");
      setAdminBookings((result as AdminBooking[]).sort((a, b) => a.arrival.localeCompare(b.arrival)));
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Buchungen konnten nicht geladen werden.");
    } finally {
      setAdminBusy(false);
    }
  };

  useEffect(() => {
    void loadMedia();
    void loadPublicBookings();
    void loadPricing();
  }, []);

  const savePricingSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdminBusy(true);
    setPricingStatus("");
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/pricing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingDraft),
      });
      const result = await response.json() as Pricing | { message?: string };
      if (!response.ok) throw new Error("message" in result ? result.message : "Preise konnten nicht gespeichert werden.");
      setPricing(result as Pricing);
      setPricingDraft(result as Pricing);
      setPricingStatus("Saisonpreise wurden gespeichert.");
    } catch (error) {
      setPricingStatus(error instanceof Error ? error.message : "Preise konnten nicht gespeichert werden.");
    } finally {
      setAdminBusy(false);
    }
  };

  const submitBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: { arrival?: string; departure?: string } = {};
    if (!arrival) errors.arrival = "Bitte wählen Sie ein Anreisedatum.";
    if (!departure) errors.departure = "Bitte wählen Sie ein Abreisedatum.";
    if (arrival && departure && departure <= arrival) errors.departure = "Die Abreise muss nach der Anreise liegen.";
    if (priceSummary && priceSummary.nights < minimumStayNights) errors.departure = `Der Mindestaufenthalt beträgt ${minimumStayNights} Nächte.`;
    setBookingErrors(errors);
    if (Object.keys(errors).length) {
      trackEvent("booking_validation_failed", { field: errors.arrival ? "arrival" : "departure" });
      return;
    }
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      trackEvent("booking_validation_failed", { field: "contact" });
      return;
    }
    setBookingBusy(true);
    setBookingStatus("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch(`${apiBase}/api/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Die Anfrage konnte nicht gesendet werden.");
      setBookingStatus("Vielen Dank! Wir haben Ihre Anfrage erhalten und melden uns persönlich bei Ihnen.");
      trackEvent("booking_inquiry_success");
      form.reset();
      setArrival("");
      setDeparture("");
      setGuests(2);
      await loadPublicBookings();
    } catch (error) {
      trackEvent("booking_inquiry_failed");
      setBookingStatus(error instanceof Error ? error.message : "Die Anfrage konnte nicht gesendet werden.");
    } finally {
      setBookingBusy(false);
    }
  };

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  const navigateFromMenu = (event: MouseEvent<HTMLAnchorElement>, targetId: string) => {
    setMenuOpen(false);
    if (isImpressum || isDatenschutz) return;

    event.preventDefault();
    document.body.classList.remove("menu-open");
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${targetId}`);
    });
  };

  useEffect(() => {
    if (activePhoto === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePhoto(null);
      if (event.key === "ArrowRight") setActivePhoto((activePhoto + 1) % gallery.length);
      if (event.key === "ArrowLeft") setActivePhoto((activePhoto - 1 + gallery.length) % gallery.length);
    };
    document.body.classList.add("lightbox-open");
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("lightbox-open"); window.removeEventListener("keydown", onKey); };
  }, [activePhoto]);

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setMediaError("");
    try {
      for (const file of files) {
        const response = await authenticatedRequest(`${apiBase}/api/media`, {
          method: "POST",
          headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
        if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? "Upload fehlgeschlagen.");
      }
      await loadMedia();
      event.target.value = "";
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  };

  const updateMedia = async (item: MediaItem, changes: Partial<Pick<MediaItem, "title" | "placement" | "order">>) => {
    setMedia((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...changes } : candidate));
    const response = await authenticatedRequest(`${apiBase}/api/media/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    if (!response.ok) { setMediaError("Die Änderung konnte nicht gespeichert werden."); await loadMedia(); }
  };

  const moveMedia = async (item: MediaItem, offset: -1 | 1) => {
    const currentIndex = sortedMedia.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sortedMedia.length) return;

    const reordered = [...sortedMedia];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    const normalized = reordered.map((candidate, index) => ({ ...candidate, order: index + 1 }));
    setMedia(normalized);
    setMediaError("");

    try {
      const response = await authenticatedRequest(`${apiBase}/api/media/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: normalized.map((candidate) => candidate.id) }),
      });
      if (!response.ok) throw new Error();
      setMedia(await response.json() as MediaItem[]);
    } catch {
      setMediaError("Die Reihenfolge konnte nicht gespeichert werden.");
      await loadMedia();
    }
  };

  const deleteMedia = async (item: MediaItem) => {
    if (!window.confirm(`„${item.title}“ endgültig löschen?`)) return;
    const response = await authenticatedRequest(`${apiBase}/api/media/${item.id}`, { method: "DELETE" });
    if (response.ok) setMedia((current) => current.filter((candidate) => candidate.id !== item.id));
    else setMediaError("Das Bild konnte nicht gelöscht werden.");
  };

  const openBookingManager = () => {
    setManagerSection("bookings");
    setManagerOpen(true);
    if (adminAuthenticated) void loadAdminBookings();
  };

  const createAdminBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    const form = event.currentTarget;
    try {
      const response = await adminRequest("", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json() as AdminBooking | { message?: string };
      if (!response.ok) throw new Error("message" in result ? result.message : "Buchung konnte nicht angelegt werden.");
      form.reset();
      await Promise.all([loadAdminBookings(), loadPublicBookings()]);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Buchung konnte nicht angelegt werden.");
    } finally {
      setAdminBusy(false);
    }
  };

  const updateAdminBooking = async (booking: AdminBooking) => {
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await adminRequest(`/${booking.id}`, { method: "PATCH", body: JSON.stringify(booking) });
      const result = await response.json() as AdminBooking | { message?: string };
      if (!response.ok) throw new Error("message" in result ? result.message : "Buchung konnte nicht gespeichert werden.");
      setAdminBookings((current) => current.map((item) => item.id === booking.id ? result as AdminBooking : item));
      await loadPublicBookings();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Buchung konnte nicht gespeichert werden.");
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteAdminBooking = async (booking: AdminBooking) => {
    if (!window.confirm(`Buchung von „${booking.name}“ endgültig löschen?`)) return;
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await adminRequest(`/${booking.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? "Buchung konnte nicht gelöscht werden.");
      setAdminBookings((current) => current.filter((item) => item.id !== booking.id));
      await loadPublicBookings();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Buchung konnte nicht gelöscht werden.");
    } finally {
      setAdminBusy(false);
    }
  };

  const exportBookingCalendar = async () => {
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/bookings/export.xlsx`);
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? "Excel-Export fehlgeschlagen.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "kalender-2027-buchungen.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Excel-Export fehlgeschlagen.");
    } finally {
      setAdminBusy(false);
    }
  };

  const exportBookingCalendarPdf = async () => {
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/bookings/export.pdf`);
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? "PDF-Export fehlgeschlagen.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "kalender-2027-buchungen.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "PDF-Export fehlgeschlagen.");
    } finally {
      setAdminBusy(false);
    }
  };

  const exportMigration = async () => {
    setMigrationBusy(true);
    setMigrationStatus("");
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/migration/export`);
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? "Export fehlgeschlagen.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `casa-baia-migration-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMigrationStatus("Export wurde heruntergeladen.");
    } catch (error) {
      setMigrationStatus(error instanceof Error ? error.message : "Export fehlgeschlagen.");
    } finally {
      setMigrationBusy(false);
    }
  };

  const importMigration = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!window.confirm("Der Import ersetzt alle aktuellen Buchungen, Bilddaten und hochgeladenen Bilder. Fortfahren?")) {
      event.target.value = "";
      return;
    }
    setMigrationBusy(true);
    setMigrationStatus("");
    try {
      const response = await authenticatedRequest(`${apiBase}/api/admin/migration/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: file,
        signal: AbortSignal.timeout(migrationImportTimeoutMs),
      });
      const result = await response.json() as { message?: string; migrationVersion?: number; jsonFiles?: number; files?: number };
      if (!response.ok) throw new Error(result.message ?? "Import fehlgeschlagen.");
      await Promise.all([loadMedia(), loadPublicBookings(), loadAdminBookings()]);
      setMigrationStatus(`${result.message} Version ${result.migrationVersion} · ${result.jsonFiles} JSON-Dateien · ${result.files} Bilder/Dateien`);
    } catch (error) {
      setMigrationStatus(error instanceof Error ? error.message : "Import fehlgeschlagen.");
    } finally {
      setMigrationBusy(false);
      event.target.value = "";
    }
  };

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/#home" aria-label="CASA BAIA SANT'ANNA – Startseite">
          <BrandMark />
          <span className="brand-copy"><strong>CASA BAIA SANT'ANNA</strong><small>Sardegna</small></span>
        </a>
        {!isImpressum && !isDatenschutz && <a className="header-cta" href="#anfrage" onClick={() => trackEvent("cta_click", { placement: "header" })}>Verfügbarkeit prüfen</a>}
        <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Menü öffnen">
          <span>Menü</span><i /><i />
        </button>
      </header>

      <button className="manage-button" onClick={() => setManagerOpen(true)} aria-label="Inhalte verwalten">Inhalte verwalten</button>

      <div className={`menu-panel ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
        <button className="close-button" onClick={() => setMenuOpen(false)} aria-label="Menü schließen">Schließen <span>×</span></button>
        <nav>{links.map((link, i) => <a key={link} href={`/#${menuTargets[i]}`} onClick={(event) => navigateFromMenu(event, menuTargets[i])}><small>0{i + 1}</small>{link}</a>)}<a className="menu-cta" href="/#anfrage" onClick={(event) => { navigateFromMenu(event, "anfrage"); trackEvent("cta_click", { placement: "menu" }); }}><small>06</small>Aufenthalt anfragen</a></nav>
        <p>Sardinien, Italien<br />info@casa-baia-sant-anna.com</p>
      </div>

      {isImpressum ? <main className="legal-page">
        <section className="legal-hero">
          <p className="eyebrow">Rechtliche Hinweise</p>
          <h1>Impressum</h1>
        </section>
        <section className="legal-content">
          <div className="section-number">01 <span /></div>
          <div className="legal-details">
            <h2>CASA BAIA SANT'ANNA</h2>
            <div className="legal-copy">
              <p>Susanne Adrian-Fuchs &amp; Gerald Fuchs</p>
              <address>Chemnitzer Strasse 8<br />78658 Zimmern o.R.<br />Deutschland</address>
              <p><a href="tel:+4974134898934">+49 (0) 741 34898934</a><br /><a href="mailto:info@casa-baia-sant-anna.com">info@casa-baia-sant-anna.com</a><br /><a href="https://www.casa-baia-sant-anna.com">www.casa-baia-sant-anna.com</a></p>
              <hr />
              <h3>Online-Streitbeilegung</h3>
              <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit. Die Plattform finden Sie unter: <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noreferrer">ec.europa.eu/consumers/odr</a>.</p>
              <p>Als Kunde haben Sie jederzeit die Möglichkeit, die Schlichtungsstelle der Europäischen Kommission zu kontaktieren. Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle der Europäischen Kommission teilzunehmen.</p>
              <p className="site-credit"><strong>Internetauftritt</strong><br />Gerald Fuchs</p>
            </div>
          </div>
        </section>
      </main> : isDatenschutz ? <main className="legal-page">
        <section className="legal-hero">
          <p className="eyebrow">Informationen nach Art. 13 DSGVO</p>
          <h1>Datenschutz</h1>
        </section>
        <section className="legal-content">
          <div className="section-number">01 <span /></div>
          <div className="legal-details">
            <h2>Ihre Daten.<br /><em>Ihre Rechte.</em></h2>
            <div className="legal-copy">
              <p>Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend den gesetzlichen Datenschutzvorschriften.</p>

              <h3>1. Verantwortliche</h3>
              <p>Verantwortlich für die Datenverarbeitung auf dieser Website sind:</p>
              <address>Susanne Adrian-Fuchs &amp; Gerald Fuchs<br />Chemnitzer Strasse 8<br />78658 Zimmern o.R.<br />Deutschland</address>
              <p>Telefon: <a href="tel:+4974134898934">+49 (0) 741 34898934</a><br />E-Mail: <a href="mailto:info@casa-baia-sant-anna.com">info@casa-baia-sant-anna.com</a></p>

              <hr />
              <h3>2. Aufruf der Website und Server-Protokolle</h3>
              <p>Beim Aufruf der Website übermittelt Ihr Browser technisch erforderliche Daten an den Webserver. Dazu können insbesondere IP-Adresse, Datum und Uhrzeit des Zugriffs, aufgerufene Seite oder Datei, zuvor besuchte Seite, Browsertyp und Betriebssystem gehören. Die Verarbeitung ist erforderlich, um die Website sicher und zuverlässig bereitzustellen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt im sicheren und störungsfreien Betrieb unseres Internetauftritts.</p>
              <p>Unser Hosting-Dienstleister verarbeitet diese Daten in unserem Auftrag. Protokolldaten werden gelöscht, sobald sie für die genannten Zwecke nicht mehr erforderlich sind, sofern keine gesetzliche Aufbewahrungspflicht oder ein sicherheitsrelevanter Vorfall eine längere Speicherung erfordert.</p>

              <h3>3. Buchungsanfragen</h3>
              <p>Wenn Sie eine Buchungsanfrage senden, verarbeiten wir die von Ihnen eingegebenen Daten: An- und Abreisedatum, Name, E-Mail-Adresse, Anzahl der Gäste sowie Ihre optionale Nachricht. Wir verwenden diese Angaben, um die Verfügbarkeit zu prüfen, Ihre Anfrage zu bearbeiten und mit Ihnen Kontakt aufzunehmen.</p>
              <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahmen und, bei anschließender Buchung, Vertragserfüllung). Nicht zum Vertrag führende Anfragen löschen wir, sobald die Bearbeitung abgeschlossen ist und keine berechtigten Interessen oder gesetzlichen Pflichten entgegenstehen. Daten zu zustande gekommenen Buchungen bewahren wir im Rahmen der geltenden handels- und steuerrechtlichen Pflichten auf; Rechtsgrundlage hierfür ist Art. 6 Abs. 1 lit. c DSGVO.</p>
              <p>Im öffentlich sichtbaren Belegungskalender erscheinen ausschließlich Reisezeiträume und deren Status. Namen, E-Mail-Adressen, Gästezahlen und Nachrichten werden dort nicht veröffentlicht.</p>

              <h3>4. Kontakt per E-Mail oder Telefon</h3>
              <p>Wenn Sie uns per E-Mail oder Telefon kontaktieren, verarbeiten wir Ihre Angaben zur Bearbeitung Ihres Anliegens. Bezieht sich die Anfrage auf eine mögliche oder bestehende Buchung, ist Art. 6 Abs. 1 lit. b DSGVO die Rechtsgrundlage. Bei sonstigen Anliegen erfolgt die Verarbeitung auf Grundlage unseres berechtigten Interesses an der Beantwortung Ihrer Anfrage gemäß Art. 6 Abs. 1 lit. f DSGVO. Die Daten werden gelöscht, sobald das Anliegen abschließend geklärt ist und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p>

              <h3>5. Cookies, Analyse und externe Inhalte</h3>
              <p>Diese Website setzt keine Cookies ein und verwendet keine Analyse-, Marketing- oder Trackingdienste. Schriften und Bilder werden ohne Verbindung zu externen Schrift- oder Bilddiensten bereitgestellt.</p>

              <h3>6. Empfänger und Übermittlung</h3>
              <p>Personenbezogene Daten erhalten nur die Stellen, die sie zur Erfüllung der genannten Zwecke benötigen. Neben uns kann dies insbesondere unser Hosting-Dienstleister als Auftragsverarbeiter sein. Eine Übermittlung in ein Drittland außerhalb der Europäischen Union oder des Europäischen Wirtschaftsraums ist durch die Website nicht vorgesehen.</p>

              <h3>7. Ihre Rechte</h3>
              <p>Sie haben im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) und Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. e oder f DSGVO (Art. 21 DSGVO).</p>
              <p>Zur Ausübung Ihrer Rechte genügt eine Nachricht an <a href="mailto:info@casa-baia-sant-anna.com">info@casa-baia-sant-anna.com</a>. Sie haben außerdem das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren, insbesondere in dem Mitgliedstaat Ihres Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.</p>

              <h3>8. Stand und Änderungen</h3>
              <p>Stand dieser Datenschutzerklärung: August 2026. Wir passen sie an, wenn sich die Website, unsere Verarbeitung oder die rechtlichen Anforderungen ändern.</p>
            </div>
          </div>
        </section>
      </main> : <main id="home">
        <section className="hero" style={{ backgroundImage: `url(${heroImage})` }}>
          <div className="hero-shade" />
          <div className="hero-content">
            <p className="eyebrow">Ein Rückzugsort am Meer</p>
            <h1>Benvenuti<br />in Sardegna</h1>
            <a href="#entdecken" className="round-link" aria-label="Mehr entdecken"><span>Entdecken</span><b>↓</b></a>
          </div>
          <p className="hero-note">40° 42' N<br />9° 43' E</p>
        </section>

        <nav className="quick-facts" aria-label="Die Casa auf einen Blick">
          <a href="#casa"><span>Gäste</span><strong>Bis 4 Personen</strong></a>
          <a href="#casa"><span>Schlafen</span><strong>2 Schlafzimmer</strong></a>
          <a href="#casa"><span>Komfort</span><strong>1 Bad · Privatpool</strong></a>
          <a href="#lage"><span>Strand</span><strong>Wenige Minuten zu Fuß</strong></a>
          <a href="#lage"><span>Lage</span><strong>Baia Sant’Anna</strong></a>
          <a href="#preise"><span>Preis</span><strong>Ab € 120 / Nacht</strong></a>
        </nav>

        <section className="welcome" id="entdecken">
          <div className="section-number">01 <span /></div>
          <div className="welcome-heading">
            <p className="eyebrow dark">Willkommen</p>
            <h2>Ein Ort, der<br /><em>bleibt.</em></h2>
          </div>
          <div className="welcome-copy">
            <p className="lead">Zwischen duftender Macchia und dem glasklaren Wasser Sardiniens liegt ein Zuhause für stille, sonnige Tage.</p>
            <p>Unser Ferienhaus verbindet Ruhe, Natur und mediterrane Leichtigkeit. Die Küste beginnt fast vor der Haustür, während der Blick weit über die ursprüngliche Landschaft bis zu den Bergen schweift.</p>
            <p>Wir haben diesen besonderen Platz geschaffen, um anzukommen, loszulassen und die einfachen Dinge wieder bewusst zu genießen.</p>
            <p className="signature">Susanne &amp; Gerald</p>
            <a className="text-link" href="#casa">Die Casa kennenlernen <span>→</span></a>
          </div>
        </section>

        <section className="casa-section" id="casa" aria-labelledby="casa-title">
          <div className="casa-intro">
            <div className="section-number">02 <span /></div>
            <div className="casa-heading">
              <p className="eyebrow dark">La Casa</p>
              <h2 id="casa-title">Unser<br /><em>Wohlfühlort.</em></h2>
            </div>
            <div className="casa-copy">
              <p className="lead">Hier finden wir Ruhe, Entspannung und neue Energie – unser ganz persönlicher Rückzugsort, um die Seele baumeln zu lassen und den Alltag hinter uns zu lassen.</p>
              <p>Direkt am Naturschutzgebiet gelegen, bietet unser Ferienhaus einen atemberaubenden Panoramablick über die sardische Landschaft bis hin zu den Bergen. Umgeben von der immergrünen, duftenden Macchia erleben wir abends spektakuläre Sonnenuntergänge, die den Himmel in warmen Farben erstrahlen lassen.</p>
              <p>Von unserem Haus aus erreichen Sie den wunderschönen Sandstrand Porto Ainu bequem zu Fuß. Ein malerischer Küstenweg führt von dort, vorbei an einer Strandbar und durch einen duftenden Pinienwald, weiter zu den Stränden Sant’Anna, Sa Capannizza und Budoni – ein Paradies für Spaziergänger und Naturliebhaber.</p>
            </div>
          </div>

          <div className="casa-details">
            <article className="casa-feature casa-feature-main">
              <img className="casa-feature-image" src={ausstattungImage} alt="Helle, moderne Ausstattung der Casa" loading="lazy" />
              <p className="feature-number">01</p>
              <div><h3>Ausstattung</h3><p>Unsere neue Casa ist hell, modern und gemütlich eingerichtet. Wir haben großen Wert auf eine gute und komfortable Ausstattung gelegt, damit das Haus zu jeder Jahreszeit genutzt werden kann.</p><p>Das Haus umfasst einen offenen Wohn- und Essbereich mit gut ausgestatteter Küche, eine angrenzende große Terrasse mit Privatpool, zwei Schlafzimmer und ein Badezimmer. Kostenloses WLAN ist überall verfügbar. Moderne Klimageräte befinden sich in den Schlafräumen und im Wohn- und Essbereich. Alle Fenster sind mit hochwertigen, beweglichen Jalousien und Fliegengittern versehen.</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={wohnenKuecheImage} alt="Offener Wohnbereich mit Küche" loading="lazy" />
              <p className="feature-number">02</p>
              <div><h3>Wohnen &amp; Küche</h3><p>Flat-TV mit Satellitenempfang und Amazon Fire TV Stick · Klimaanlage und Heizung · kostenloses WLAN · Sofa · Geschirrspüler · Gasherd · Backofen · Kühlschrank mit Gefrierfach · Mikrowelle · Lavazza Kaffee- und Espressomaschine · gute Küchenausstattung</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={terrasseImage} alt="Terrasse mit Blick in die sardische Landschaft" loading="lazy" />
              <p className="feature-number">03</p>
              <div><h3>Terrasse</h3><p>Die große Terrasse mit angrenzendem Privatpool bietet einen unverbauten Panoramablick. Hier befinden sich die Außendusche mit Warmwasser, die praktische Außenküche und, separat untergebracht, die Waschmaschine.</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={badezimmerImage} alt="Badezimmer der Casa" loading="lazy" />
              <p className="feature-number">04</p>
              <div><h3>Badezimmer</h3><p>Geräumig und mit Fenster · Waschbecken · Dusche · WC · Bidet · Ablageflächen</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={schlafzimmerImage} alt="Schlafzimmer mit Doppelbett" loading="lazy" />
              <p className="feature-number">05</p>
              <div><h3>Schlafzimmer</h3><p>Doppelbett 160 × 200 cm · Klimaanlage und Heizung · großer Kleiderschrank · Kommode · Spiegel · Nachttische · direkter Zugang zum Außenbereich</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={kinderzimmerImage} alt="Schlafzimmer mit zwei Einzelbetten" loading="lazy" />
              <p className="feature-number">06</p>
              <div><h3>Schlafzimmer</h3><p>Zwei Einzelbetten 90 × 200 cm, als Doppelbett 180 × 200 cm nutzbar · Klimaanlage und Heizung · Kleiderschrank · Nachttische</p></div>
            </article>
            <article className="casa-feature">
              <img className="casa-feature-image" src={gartenImage} alt="Mediterran angelegter Garten" loading="lazy" />
              <p className="feature-number">07</p>
              <div><h3>Garten</h3><p>Der große Garten grenzt an ein Naturschutzgebiet und ist terrassenartig und liebevoll mediterran angelegt. Der Blick schweift weit in die reizvolle, landestypische Natur. Es gibt viel Platz für Ruhe und Privatsphäre.</p></div>
            </article>
            <article className="casa-feature">
              <p className="feature-number">08</p>
              <div><h3>Zugang &amp; Parken</h3><p>Das Grundstück ist mit einem abschließbaren Tor gesichert. Dahinter befindet sich der Pkw-Stellplatz; weitere Parkmöglichkeiten liegen direkt am Grundstück.</p></div>
            </article>
          </div>
          <div className="section-cta"><a href="#anfrage" onClick={() => trackEvent("cta_click", { placement: "casa" })}>Aufenthalt anfragen <span>→</span></a></div>
        </section>
        <section className="gallery-section" id="galerie">
          <div className="gallery-intro">
            <div className="section-number">03 <span /></div>
            <div><p className="eyebrow dark">Impressionen</p><h2>Augenblicke<br /><em>am Pool & Meer.</em></h2></div>
            <p>Ein Haus zwischen Himmel und Macchia. Entdecken Sie die stillen Ecken, das warme Licht und den Blick auf Sardiniens Küste.</p>
          </div>
          <div className="gallery-grid">
            {gallery.map((photo, index) => <button className={`gallery-card ${portraitPhotoIds.has(photo.id) ? "portrait" : ""} ${photo.className ?? ""}`} key={photo.id} onClick={() => { setActivePhoto(index); trackEvent("gallery_open", { index: index + 1 }); }} aria-label={`${photo.title} vergrößern`}>
              <img src={photo.src} style={{ objectPosition: photo.position }} alt={photo.title} loading="lazy" onLoad={({ currentTarget }) => {
                if (currentTarget.naturalHeight > currentTarget.naturalWidth) {
                  setPortraitPhotoIds((current) => current.has(photo.id) ? current : new Set(current).add(photo.id));
                }
              }} />
              <span className="gallery-overlay"><small>{String(index + 1).padStart(2, "0")}</small><b>＋</b></span>
            </button>)}
          </div>
          <div className="section-cta"><a href="#anfrage" onClick={() => trackEvent("cta_click", { placement: "gallery" })}>Verfügbarkeit prüfen <span>→</span></a></div>
        </section>

        <section className="location-section" id="lage" aria-labelledby="location-title">
          <div className="location-intro">
            <div className="section-number">04 <span /></div>
            <div>
              <p className="eyebrow">Lage &amp; Infos</p>
              <h2 id="location-title">Zwischen Meer<br /><em>und Macchia.</em></h2>
            </div>
            <div className="location-lead">
              <p>Die Casa liegt in Baia Sant’Anna, einem kleinen, ruhigen Ort im Nordosten Sardiniens – als letztes Haus der Straße direkt an einem Naturschutzgebiet, mit weitem, unverbautem Blick in die ursprüngliche Landschaft.</p>
              <p>Strand und Meer erreichen Sie in wenigen Minuten zu Fuß. Weitere traumhafte Strände und Ausflugsziele liegen ganz in der Nähe.</p>
            </div>
          </div>

          <div className="location-details">
            <article>
              <span>01</span>
              <h3>Alles in der Nähe</h3>
              <p>Baia Sant’Anna grenzt an Tanaunella und gehört zur Gemeinde Budoni. Dort finden Sie alles für den täglichen Bedarf: Supermärkte, Bäckereien, Metzgereien, Apotheken, Ärzte, Banken, Geschäfte und eine große Auswahl an Restaurants.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Gut erreichbar</h3>
              <p>Die Küstenstraße SS125 führt direkt an Baia Sant’Anna vorbei und verbindet den Nordosten mit vielen sehenswerten Orten der Insel. Vom Hafen oder Flughafen Olbia erreichen Sie die Casa über die SS125 oder SS131 in etwa 30 bis 35 Minuten.</p>
            </article>
          </div>

          <figure className="location-map">
            <a className="location-map-link" href={googleMapsUrl} target="_blank" rel="noreferrer" aria-label="Position der Casa in Google Maps öffnen" onClick={() => trackEvent("map_click")}>
              <img src={locationMapImage} alt="Illustrierte Lagekarte der CASA BAIA SANT'ANNA bei den Koordinaten 40.6855258 Nord und 9.7383962 Ost" loading="lazy" />
            </a>
            <figcaption>
              <div><span>Exakte Position</span><strong>40.6855258 N · 9.7383962 E</strong></div>
              <a href={googleMapsUrl} target="_blank" rel="noreferrer">In Google Maps öffnen <span>↗</span></a>
            </figcaption>
          </figure>

          <div className="location-guide">
            <div className="distance-panel">
              <p className="eyebrow">Entfernungen mit dem Auto</p>
              <dl>{destinations.map(([place, duration]) => <div key={place}><dt>{place}</dt><dd>{duration}</dd></div>)}</dl>
            </div>
            <div className="activity-panel">
              <p className="eyebrow">Freizeitmöglichkeiten</p>
              <h3>Draußen zuhause.</h3>
              <ul>{activities.map((activity) => <li key={activity}>{activity}</li>)}</ul>
            </div>
          </div>
          <div className="section-cta section-cta-light"><a href="#anfrage" onClick={() => trackEvent("cta_click", { placement: "location" })}>Aufenthalt anfragen <span>→</span></a></div>
        </section>

        <section className="prices-section" id="preise" aria-labelledby="prices-title">
          <div className="prices-intro">
            <div className="section-number">05 <span /></div>
            <div><p className="eyebrow dark">Preise &amp; Kalender</p><h2 id="prices-title">Zeit für<br /><em>Sardinien.</em></h2></div>
            <p>Die Casa bietet Platz für bis zu vier Personen. Wählen Sie Ihren Reisezeitraum und senden Sie uns direkt Ihre unverbindliche Buchungsanfrage.</p>
          </div>
          <div className="rate-grid">
            <article><small>November – März</small><h3>€ {pricing.lowSeason}</h3><p>pro Nacht · Nebensaison</p></article>
            <article><small>April – Juni · Oktober</small><h3>€ {pricing.midSeason}</h3><p>pro Nacht · Zwischensaison</p></article>
            <article><small>Juli – September</small><h3>€ {pricing.highSeason}</h3><p>pro Nacht · Hauptsaison</p></article>
          </div>
          <p className="price-note">Mindestaufenthalt 10 Nächte · Endreinigung € 150 · Wäschepaket € 25 pro Person · Die Übernachtungspreise gelten für das gesamte Haus.</p>
          <div className="booking-calendar" aria-labelledby="calendar-title">
            <div className="calendar-header">
              <div><p className="eyebrow dark">Belegungskalender</p><h3 id="calendar-title">Verfügbarkeit<br /><em>auf einen Blick.</em></h3></div>
              <div className="calendar-controls">
                <button type="button" onClick={() => setCalendarMonth((month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))} aria-label="Vorherige Monate">←</button>
                <button type="button" onClick={() => { const now = new Date(); setCalendarMonth(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))); }}>Heute</button>
                <button type="button" onClick={() => setCalendarMonth((month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))} aria-label="Nächste Monate">→</button>
              </div>
            </div>
            <div className="calendar-months">{visibleMonths.map((month) => <BookingMonth month={month} bookings={activeBookings} key={month.toISOString()} />)}</div>
            <div className="calendar-footer">
              <div className="calendar-legend" aria-label="Kalenderlegende"><span><i />Verfügbar</span><span><i className="is-unavailable" />Nicht verfügbar</span></div>
              <button className="manage-bookings-button" type="button" onClick={openBookingManager}>Buchungen verwalten <span>→</span></button>
            </div>
          </div>
          <div className="booking-layout" id="anfrage">
            <div className="availability-copy">
              <p className="eyebrow dark">Verfügbarkeit</p>
              <h3>Ihre Auszeit<br /><em>anfragen.</em></h3>
              <p>Ihre Anfrage ist unverbindlich. Wir prüfen den Zeitraum persönlich und antworten in der Regel innerhalb von 24 Stunden.</p>
              <ol className="booking-steps"><li><span>1</span>Reisedaten wählen</li><li><span>2</span>Unverbindlich anfragen</li><li><span>3</span>Persönliche Bestätigung erhalten</li></ol>
              <div className="booking-contact"><strong>Fragen vor der Buchung?</strong><a href="mailto:info@casa-baia-sant-anna.com">info@casa-baia-sant-anna.com</a><a href="tel:+4974134898934">+49 (0) 741 34898934</a></div>
            </div>
            <form className="booking-form" onSubmit={submitBooking} onFocus={() => trackEvent("booking_form_start")} noValidate>
              <div className="form-row"><label>Anreise<input required name="arrival" type="date" value={arrival} min={new Date().toISOString().slice(0, 10)} aria-describedby={bookingErrors.arrival ? "arrival-error" : undefined} aria-invalid={Boolean(bookingErrors.arrival)} onChange={(event) => { setArrival(event.target.value); setBookingErrors((current) => ({ ...current, arrival: undefined })); }} />{bookingErrors.arrival && <span className="field-error" id="arrival-error">{bookingErrors.arrival}</span>}</label><label>Abreise<input required name="departure" type="date" value={departure} min={minimumDeparture || new Date().toISOString().slice(0, 10)} aria-describedby={bookingErrors.departure ? "departure-error" : undefined} aria-invalid={Boolean(bookingErrors.departure)} onChange={(event) => { setDeparture(event.target.value); setBookingErrors((current) => ({ ...current, departure: undefined })); }} />{bookingErrors.departure && <span className="field-error" id="departure-error">{bookingErrors.departure}</span>}</label></div>
              <div className="form-row"><label>Name<input required name="name" autoComplete="name" /></label><label>E-Mail<input required name="email" type="email" autoComplete="email" /></label></div>
              <label>Gäste<select name="guests" value={guests} onChange={(event) => setGuests(Number(event.target.value))}><option value="1">1 Person</option><option value="2">2 Personen</option><option value="3">3 Personen</option><option value="4">4 Personen</option></select></label>
              <label>Nachricht (optional)<textarea name="message" rows={4} placeholder="Was dürfen wir über Ihre Reise wissen?" /></label>
              <div className="price-summary" aria-live="polite"><strong>{priceSummary ? `Voraussichtlich € ${priceSummary.total.toLocaleString("de-DE")}` : "Preisübersicht"}</strong><span>{priceSummary ? `${priceSummary.nights} Nächte € ${priceSummary.accommodation.toLocaleString("de-DE")} · Endreinigung € ${cleaningFee} · Wäschepaket € ${priceSummary.laundry}` : "Reisedaten wählen für eine unverbindliche Schätzung"}</span><small>Mindestaufenthalt 10 Nächte · keine Zahlung bei Anfrage</small></div>
              <p className="form-privacy-note">Hinweise zur Verarbeitung Ihrer Angaben finden Sie in unserer <a href="/datenschutz">Datenschutzerklärung</a>.</p>
              <button disabled={bookingBusy} type="submit">{bookingBusy ? "Wird gesendet …" : "Verfügbarkeit prüfen & anfragen"}<span>→</span></button>
              {bookingStatus && <p className="booking-status" role="status">{bookingStatus}</p>}
            </form>
          </div>
        </section>


      </main>}

      {!isImpressum && !isDatenschutz && <a className="mobile-booking-cta" href="#anfrage" onClick={() => trackEvent("cta_click", { placement: "mobile_sticky" })}>Verfügbarkeit prüfen <span>→</span></a>}

      {activePhoto !== null && <div className="lightbox" role="dialog" aria-modal="true" aria-label="Bildergalerie" onClick={() => setActivePhoto(null)}>
        <button className="lightbox-close" onClick={() => setActivePhoto(null)} aria-label="Galerie schließen">Schließen <span>×</span></button>
        <button className="lightbox-arrow" onClick={(e) => { e.stopPropagation(); setActivePhoto((activePhoto - 1 + gallery.length) % gallery.length); }} aria-label="Vorheriges Bild">←</button>
        <figure onClick={(e) => e.stopPropagation()}><img src={gallery[activePhoto].src} style={{ objectPosition: gallery[activePhoto].position }} alt={gallery[activePhoto].title} /><figcaption><span>{String(activePhoto + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}</span></figcaption></figure>
        <button className="lightbox-arrow" onClick={(e) => { e.stopPropagation(); setActivePhoto((activePhoto + 1) % gallery.length); }} aria-label="Nächstes Bild">→</button>
      </div>}

      {managerOpen && <div className="media-manager" role="dialog" aria-modal="true" aria-labelledby="manager-title">
        <div className="manager-header">
          <div><p className="eyebrow">Website-Inhalte</p><h2 id="manager-title">Inhalte verwalten</h2></div>
          <button className="manager-close" onClick={() => setManagerOpen(false)} aria-label="Verwaltung schließen">×</button>
        </div>
        {!adminAuthenticated ? <form className="admin-login" onSubmit={authenticateAdmin}>
          <label>Verwaltungsschlüssel<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} autoComplete="current-password" required /></label>
          <button type="submit" disabled={adminBusy}>{adminBusy ? "Wird geprüft …" : "Anmelden"}</button>
          {adminError && <p className="manager-error" role="alert">{adminError}</p>}
        </form> : <>
          <nav className="manager-tabs" aria-label="Verwaltungsbereiche">
            <button className={managerSection === "images" ? "is-active" : ""} onClick={() => setManagerSection("images")}>Bilder</button>
            <button className={managerSection === "bookings" ? "is-active" : ""} onClick={() => { setManagerSection("bookings"); void loadAdminBookings(); }}>Buchungen</button>
            <button className={managerSection === "pricing" ? "is-active" : ""} onClick={() => setManagerSection("pricing")}>Preise</button>
            <button className={managerSection === "migration" ? "is-active" : ""} onClick={() => setManagerSection("migration")}>Migration</button>
          </nav>
          {managerSection === "images" && <><div className="manager-toolbar">
            <label className={`upload-button ${uploading ? "is-busy" : ""}`}>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={uploadImages} disabled={uploading} />
              {uploading ? "Wird hochgeladen …" : "＋ Bilder hochladen"}
            </label>
            <p>JPEG, PNG, WebP oder GIF · maximal 10 MB</p>
            <p className="order-hint">Reihenfolge mit ↑ und ↓ festlegen</p>
          </div>
            {mediaError && <p className="manager-error" role="alert">{mediaError}</p>}
            {media.length === 0 ? <div className="manager-empty"><strong>Noch keine eigenen Bilder</strong><span>Geladene Bilder erscheinen hier und zunächst direkt in der Galerie.</span></div> :
              <div className="media-list">{sortedMedia.map((item, index) => <article className="media-row" key={item.id}>
                <span className="media-number" aria-label={`Bild Nummer ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
                <img src={`${apiBase}/uploads/${item.filename}`} alt="" />
                <div className="media-fields">
                  <label>Bildtitel<input value={item.title} onChange={(event) => setMedia((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate))} onBlur={(event) => void updateMedia(item, { title: event.target.value })} /></label>
                  <label>Platzierung<select value={item.placement} onChange={(event) => void updateMedia(item, { placement: event.target.value as MediaItem["placement"] })}><option value="gallery">In der Galerie</option><option value="library">Nur Bibliothek</option></select></label>
                </div>
                <div className="media-actions">
                  <button disabled={index === 0} onClick={() => void moveMedia(item, -1)} aria-label={`${item.title} nach oben verschieben`}>↑</button>
                  <button disabled={index === sortedMedia.length - 1} onClick={() => void moveMedia(item, 1)} aria-label={`${item.title} nach unten verschieben`}>↓</button>
                  <button className="delete-button" onClick={() => void deleteMedia(item)}>Löschen</button>
                </div>
              </article>)}</div>}</>}
          {managerSection === "bookings" && <div className="booking-manager">
            <div className="booking-debug-toggle">
              <label><input type="checkbox" checked={bookingDebug} onChange={(event) => setBookingDebug(event.target.checked)} /> Debug-Modus</label>
              <span>Zeigt technische Details ohne Gästedaten.</span>
            </div>
            {bookingDebug && <aside className="booking-debug-panel" aria-label="Buchungsdiagnose">
              <div className="booking-debug-heading"><strong>Diagnose</strong><button type="button" onClick={() => setBookingDebugEntries([])}>Leeren</button></div>
              <dl><div><dt>API</dt><dd>{apiBase || window.location.origin}</dd></div></dl>
              {bookingDebugEntries.length === 0 ? <p>Noch keine Verwaltungsanfrage ausgeführt.</p> : <ol>{bookingDebugEntries.map((entry) => <li key={entry.id} className={typeof entry.status === "number" && entry.status >= 200 && entry.status < 300 ? "is-success" : "is-error"}>
                <time>{entry.timestamp}</time><code>{entry.operation}</code><b>{entry.status}</b><span>{entry.message}</span>
              </li>)}</ol>}
            </aside>}
            <div className="booking-manager-actions">
              <button className="reload-bookings-button" type="button" disabled={adminBusy} onClick={() => void loadAdminBookings()}>{adminBusy ? "Bitte warten …" : "Buchungen neu laden"}</button>
              <button className="export-bookings-button" type="button" disabled={adminBusy} onClick={() => void exportBookingCalendar()}>Druckfertigen Excel-Kalender herunterladen</button>
              <button className="export-bookings-button" type="button" disabled={adminBusy} onClick={() => void exportBookingCalendarPdf()}>Druckfertigen PDF-Kalender herunterladen</button>
            </div>
            {adminError && <p className="manager-error" role="alert">{adminError}</p>}
            <form className="booking-create" onSubmit={createAdminBooking}>
              <h3>Neue Buchung hinzufügen</h3>
              <p className="booking-create-hint">Tragen Sie hier die Buchungsdaten ein. Bestehende Buchungen müssen vorher nicht geladen werden.</p>
              <label>Anreise<input type="date" name="arrival" required /></label>
              <label>Abreise<input type="date" name="departure" required /></label>
              <label>Status<select name="status"><option value="requested">Angefragt</option><option value="reserved">Reserviert</option><option value="booked">Gebucht</option></select></label>
              <label>Name<input name="name" required /></label>
              <label>E-Mail<input name="email" type="email" required /></label>
              <label>Gäste<input name="guests" type="number" min="1" max="4" defaultValue="2" required /></label>
              <label className="booking-message-field">Nachricht<textarea name="message" rows={2} /></label>
              <button type="submit" disabled={adminBusy}>{adminBusy ? "Wird angelegt …" : "＋ Buchung hinzufügen"}</button>
            </form>
            {adminBookings.length > 0 ? <div className="admin-booking-list">{adminBookings.map((booking) => <article className="admin-booking" key={booking.id}>
              <div className="admin-booking-heading"><strong>{booking.name}</strong><span className={`booking-badge is-${booking.status}`}>{bookingStatusLabel(booking.status)}</span></div>
              <div className="admin-booking-fields">
                <label>Anreise<input type="date" value={booking.arrival} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, arrival: event.target.value } : item))} /></label>
                <label>Abreise<input type="date" value={booking.departure} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, departure: event.target.value } : item))} /></label>
                <label>Status<select value={booking.status} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: event.target.value as BookingStatus } : item))}><option value="requested">Angefragt</option><option value="reserved">Reserviert</option><option value="booked">Gebucht</option></select></label>
                <label>Name<input value={booking.name} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, name: event.target.value } : item))} /></label>
                <label>E-Mail<input type="email" value={booking.email} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, email: event.target.value } : item))} /></label>
                <label>Gäste<input type="number" min="1" max="4" value={booking.guests} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, guests: Number(event.target.value) } : item))} /></label>
                <label className="booking-message-field">Nachricht<textarea rows={2} value={booking.message} onChange={(event) => setAdminBookings((current) => current.map((item) => item.id === booking.id ? { ...item, message: event.target.value } : item))} /></label>
              </div>
              <div className="admin-booking-actions"><button disabled={adminBusy} onClick={() => void updateAdminBooking(booking)}>Speichern</button><button className="delete-button" disabled={adminBusy} onClick={() => void deleteAdminBooking(booking)}>Löschen</button></div>
            </article>)}</div> : <div className="manager-empty"><strong>Noch keine Buchungen</strong><span>Legen Sie die erste Buchung über das Formular an.</span></div>}
          </div>}
          {managerSection === "pricing" && <form className="pricing-manager" onSubmit={savePricingSettings}>
            <div>
              <p className="eyebrow">Saisonpreise</p>
              <h3>Preis pro Nacht bearbeiten</h3>
              <p>Die Saisonzeiträume bleiben fest. Gespeicherte Preise werden sofort auf der Website und in der Preiskalkulation verwendet.</p>
            </div>
            <div className="pricing-fields">
              <label>November – März<input type="number" min="1" max="10000" step="1" value={pricingDraft.lowSeason} onChange={(event) => setPricingDraft((current) => ({ ...current, lowSeason: Number(event.target.value) }))} required /><span>€ pro Nacht · Nebensaison</span></label>
              <label>April – Juni · Oktober<input type="number" min="1" max="10000" step="1" value={pricingDraft.midSeason} onChange={(event) => setPricingDraft((current) => ({ ...current, midSeason: Number(event.target.value) }))} required /><span>€ pro Nacht · Zwischensaison</span></label>
              <label>Juli – September<input type="number" min="1" max="10000" step="1" value={pricingDraft.highSeason} onChange={(event) => setPricingDraft((current) => ({ ...current, highSeason: Number(event.target.value) }))} required /><span>€ pro Nacht · Hauptsaison</span></label>
            </div>
            <button type="submit" disabled={adminBusy}>{adminBusy ? "Wird gespeichert …" : "Preise speichern"}</button>
            {pricingStatus && <p className="pricing-status" role="status">{pricingStatus}</p>}
          </form>}
          {managerSection === "migration" && <section className="migration-manager">
            <div>
              <p className="eyebrow">Datensicherung</p>
              <h3>Instanz exportieren</h3>
              <p>Lädt alle JSON-Daten und hochgeladenen Bilder als eine versionierte Migrationsdatei herunter.</p>
              <button type="button" disabled={migrationBusy} onClick={() => void exportMigration()}>{migrationBusy ? "Bitte warten …" : "Migration exportieren"}</button>
            </div>
            <div>
              <p className="eyebrow">Wiederherstellung</p>
              <h3>Instanz importieren</h3>
              <p>Ersetzt die Daten dieser Instanz vollständig. Der Import ist nur mit derselben Migrationsversion möglich.</p>
              <label className={`migration-import ${migrationBusy ? "is-busy" : ""}`}>
                <input type="file" accept="application/json,.json" disabled={migrationBusy} onChange={importMigration} />
                Migrationsdatei auswählen
              </label>
            </div>
            {migrationStatus && <p className="migration-status" role="status">{migrationStatus}</p>}
          </section>}
        </>}
      </div>}

      <footer><a className="brand footer-brand" href="/#home"><BrandMark /><span className="brand-copy"><strong>CASA BAIA SANT'ANNA</strong><small>Sardegna</small></span></a><p>© 2026 CASA BAIA SANT'ANNA</p><p>Version {webPackage.version}</p><p><a href="/impressum">Impressum</a> &nbsp; · &nbsp; <a href="/datenschutz">Datenschutz</a></p></footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
