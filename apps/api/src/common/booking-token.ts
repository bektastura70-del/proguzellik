import { createHmac } from "node:crypto";
import { loadEnv } from "../config/env";

/** Online randevu iptal bağlantısının imzası (randevu kimliğine bağlı, süresiz; iptal kuralları ayrıca uygulanır). */
export function bookingToken(appointmentId: string) {
  return createHmac("sha256", loadEnv().JWT_SECRET).update(`booking:${appointmentId}`).digest("base64url");
}

/** Müşterinin randevusunu iptal edebileceği sayfa (göreli yol). */
export function bookingCancelPath(slug: string, appointmentId: string) {
  return `/r/${slug}/iptal?id=${appointmentId}&t=${encodeURIComponent(bookingToken(appointmentId))}`;
}
