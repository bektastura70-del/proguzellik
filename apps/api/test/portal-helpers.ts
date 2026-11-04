import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";

/** İşletme için PWA bayraklarını açar (SaaS sahibi onayını taklit eder; uç nokta testleri ayrıca vardır). */
export async function enablePwa(db: PrismaClient, tenantId: string, flags: Partial<Record<"businessPwaEnabled" | "customerPwaEnabled" | "customerBookingEnabled" | "webPushEnabled" | "customerSessionTrackingEnabled", boolean>> = {}) {
  const data = { customerPwaEnabled: true, customerBookingEnabled: true, customerSessionTrackingEnabled: true, ...flags };
  await db.tenantPwaSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
}

/** Test e-posta sağlayıcısından son doğrulama kodu */
export function lastOtp(app: INestApplication, email: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MockEmailProvider } = require("../src/email/email.provider");
  const mail = [...app.get(MockEmailProvider).outbox].reverse().find((m: { to: string; subject: string }) => m.to === email.toLowerCase() && m.subject.includes("doğrulama kodunuz"));
  return /\b(\d{6})\b/.exec(mail?.text ?? "")?.[1];
}

/** E-posta koduyla portal oturumu açar; müşteri oturum belirtecini döner. */
export async function portalLogin(app: INestApplication, slug: string, email: string) {
  const http = () => request(app.getHttpServer());
  await http().post(`/public/salons/${slug}/portal/otp`).send({ email }).expect(202);
  const code = lastOtp(app, email);
  if (!code) throw new Error("Doğrulama kodu e-postası bulunamadı");
  const r = await http().post(`/public/salons/${slug}/portal/verify`).send({ email, code }).expect(200);
  return r.body.token as string;
}

export function portal(app: INestApplication, slug: string, token?: string) {
  const server = app.getHttpServer();
  const wrap = (r: request.Test) => (token ? r.set("X-Customer-Session", token) : r);
  const base = `/public/salons/${slug}/portal`;
  return {
    get: (p: string) => wrap(request(server).get(base + p)),
    post: (p: string) => wrap(request(server).post(base + p)),
    patch: (p: string) => wrap(request(server).patch(base + p)),
    delete: (p: string) => wrap(request(server).delete(base + p)),
  };
}
