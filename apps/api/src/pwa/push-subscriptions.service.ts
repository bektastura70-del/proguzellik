import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TenantInfo } from "../common/decorators";
import { loadEnv, webPushMode } from "../config/env";
import { NotificationQueue } from "../notifications/notification-queue";
import { AUTH_RE, isAllowedPushEndpoint, P256DH_RE } from "../notifications/push/push-endpoint";
import { PUSH_TEMPLATES } from "../notifications/push/push.planner";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { EffectivePwa, effectivePwa } from "./pwa-settings";

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
type Owner = { audience: "STAFF"; userId: string } | { audience: "CUSTOMER"; identityId: string };

/** Bir kişinin en fazla bu kadar cihaz aboneliği olur; eskiler kaldırılır. */
const MAX_DEVICES = 10;

/** Cihaz push abonelikleri (personel ve müşteri). İzin her zaman kullanıcının dokunuşuyla tarayıcıda istenir. */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueue,
  ) {}

  static validate(b: SubscriptionInput) {
    if (!isAllowedPushEndpoint(b.endpoint)) throw new BadRequestException("Desteklenmeyen bildirim servisi");
    if (!P256DH_RE.test(b.keys.p256dh) || !AUTH_RE.test(b.keys.auth)) throw new BadRequestException("Geçersiz abonelik anahtarı");
  }

  static pushAvailable(pwa: EffectivePwa, audience: "STAFF" | "CUSTOMER") {
    const on = pwa.webPushEnabled && webPushMode(loadEnv()) !== "off";
    return on && (audience === "STAFF" ? pwa.businessPwaEnabled : pwa.customerBookingEnabled);
  }

  private where(o: Owner) {
    return o.audience === "STAFF" ? { audience: "STAFF", userId: o.userId } : { audience: "CUSTOMER", identityId: o.identityId };
  }

  /** Aynı tarayıcı (endpoint) başka bir kullanıcıya aitse (paylaşılan salon tableti) sahibi değişir. */
  async subscribeInTx(tx: Tx, tenantId: string, o: Owner, b: SubscriptionInput, userAgent?: string) {
    PushSubscriptionsService.validate(b);
    await tx.pushSubscription.deleteMany({ where: { tenantId, endpoint: b.endpoint } });
    await tx.pushSubscription.create({
      data: {
        tenantId, ...this.where(o), endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth,
        userAgent: userAgent?.slice(0, 200),
      },
    });
    const all = await tx.pushSubscription.findMany({ where: { tenantId, ...this.where(o) }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (all.length > MAX_DEVICES) await tx.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_DEVICES).map((x) => x.id) } } });
    return { subscribed: true, devices: Math.min(all.length, MAX_DEVICES) };
  }

  async unsubscribeInTx(tx: Tx, tenantId: string, o: Owner, endpoint: string) {
    const r = await tx.pushSubscription.deleteMany({ where: { tenantId, endpoint, ...this.where(o) } });
    return { removed: r.count };
  }

  // ---- Personel ----
  private async staffPwa(t: TenantInfo) {
    const pwa = await effectivePwa(this.prisma.platform, t.tenantId);
    if (!PushSubscriptionsService.pushAvailable(pwa, "STAFF")) throw new NotFoundException("Anlık bildirimler bu işletmede açık değil");
    return pwa;
  }

  async staffStatus(t: TenantInfo) {
    const pwa = await effectivePwa(this.prisma.platform, t.tenantId);
    const available = PushSubscriptionsService.pushAvailable(pwa, "STAFF");
    const devices = available
      ? await this.prisma.withTenant(t, (tx) => tx.pushSubscription.count({ where: { tenantId: t.tenantId, audience: "STAFF", userId: t.userId, revokedAt: null } }))
      : 0;
    return { available, devices, vapidPublicKey: available ? (loadEnv().VAPID_PUBLIC_KEY ?? null) : null };
  }

  async staffSubscribe(t: TenantInfo, b: SubscriptionInput, ua?: string) {
    await this.staffPwa(t);
    return this.prisma.withTenant(t, (tx) => this.subscribeInTx(tx, t.tenantId, { audience: "STAFF", userId: t.userId }, b, ua));
  }

  staffUnsubscribe(t: TenantInfo, endpoint: string) {
    // Kapalıyken de kaldırma yapılabilir (çıkışta veya bayrak kapatıldıktan sonra temizlik).
    return this.prisma.withTenant(t, (tx) => this.unsubscribeInTx(tx, t.tenantId, { audience: "STAFF", userId: t.userId }, endpoint));
  }

  /** Kullanıcının kendi cihazlarına deneme bildirimi (yalnızca kendisine). */
  async staffTest(t: TenantInfo) {
    await this.staffPwa(t);
    const n = await this.prisma.withTenant(t, async (tx) => {
      const devices = await tx.pushSubscription.count({ where: { tenantId: t.tenantId, audience: "STAFF", userId: t.userId, revokedAt: null } });
      if (!devices) throw new BadRequestException("Bu hesapta bildirim açılmış cihaz yok");
      return tx.notification.create({
        data: {
          tenantId: t.tenantId, channel: "WEBPUSH", recipient: `user:${t.userId}`, template: PUSH_TEMPLATES.test, kind: "SERVICE",
          payload: { title: "ProGüzellik", body: "Bildirimler bu cihazda çalışıyor.", url: "/panel/bildirim-merkezi", tag: "deneme", startsAt: new Date().toISOString(), pref: "test", requireActive: false },
        },
      });
    });
    await this.queue.enqueue(n.id, new Date());
    // mock: yerel/test ortamı, gerçek gönderim yapılmaz (arayüz bunu açıkça söyler)
    return { queued: true, id: n.id, mode: webPushMode(loadEnv()) };
  }
}
