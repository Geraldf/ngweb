import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

export class MigrationError extends Error {}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
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
