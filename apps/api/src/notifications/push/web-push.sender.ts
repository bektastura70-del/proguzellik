import { Injectable, Logger } from "@nestjs/common";
import * as webpush from "web-push";
import { loadEnv } from "../../config/env";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}
export type PushResult = { ok: true } | { ok: false; gone: boolean; status?: number; error: string };

/** Yerel/test: ağ isteği yapılmaz; gönderilenler bellekte tutulur. */
@Injectable()
export class MockWebPushSender {
  readonly outbox: { endpoint: string; message: PushMessage; ttl: number }[] = [];
  /** Testlerde belirli adreslere hata döndürmek için */
  readonly failures = new Map<string, number>();

  async send(target: PushTarget, message: PushMessage, ttl: number): Promise<PushResult> {
    const status = this.failures.get(target.endpoint);
    if (status) return { ok: false, gone: status === 404 || status === 410, status, error: `mock ${status}` };
    this.outbox.push({ endpoint: target.endpoint, message, ttl });
    return { ok: true };
  }
}

/** Gerçek gönderim (WEB_PUSH_MODE=live + VAPID anahtarları). Yük şifrelidir; yalnızca tarayıcı çözer. */
@Injectable()
export class LiveWebPushSender {
  private readonly logger = new Logger("WebPush");

  async send(target: PushTarget, message: PushMessage, ttl: number): Promise<PushResult> {
    const env = loadEnv();
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          TTL: ttl,
          urgency: "normal",
          timeout: 10_000,
          vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
        },
      );
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status !== 404 && status !== 410) this.logger.warn(`Push gönderilemedi (${status ?? "ağ"}): ${new URL(target.endpoint).hostname}`);
      return { ok: false, gone: status === 404 || status === 410, status, error: (e as Error).message.slice(0, 300) };
    }
  }
}
