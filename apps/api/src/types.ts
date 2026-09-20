export type MediaItem = {
  id: string;
  filename: string;
  title: string;
  mimeType: string;
  placement: "library" | "gallery";
  order: number;
  createdAt: string;
};

export type Booking = {
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

export type BookingFields = Omit<Booking, "id" | "createdAt">;
export type Pricing = { lowSeason: number; midSeason: number; highSeason: number };
