import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, ServiceUnavailableException } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser, PlatformAdmin } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { EmailService } from "../email/email.service";
import { EmailTemplate, TEMPLATE_META, TemplateName } from "../email/templates";
import { PrismaService } from "../prisma/prisma.service";

const historySchema = z.object({
  status: z.enum(["SENT", "FAILED", "NOT_CONFIGURED", "QUEUED"]).optional(),
  template: z.string().max(60).optional(),
  to: z.string().trim().max(200).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
});
const templateSchema = z.object({
  subject: z.string().trim().min(3).max(200).refine((v) => !/[\r\n]/.test(v), "Konu tek satır olmalı"),
  body: z.string().trim().min(10).max(4000),
});
const noticeSchema = z
  .object({
    subject: z.string().trim().min(3).max(150),
    body: z.string().trim().min(10).max(4000),
    /** Belirli işletmeler ya da durum filtresi (tümü için boş bırakılır) */
    tenantIds: z.array(z.string().uuid()).max(500).optional(),
    statuses: z.array(z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"])).max(5).optional(),
    /** Toplu gönderimde onay: yalnızca hizmet/işletim bilgilendirmesi (ticari ileti değildir) */
    serviceNoticeConfirmed: z.literal(true, { error: "Yalnızca hizmet bilgilendirmesi gönderilebilir; onay kutusunu işaretleyin" }),
    requestId: z.string().uuid(),
  })
  .refine((v) => !(v.tenantIds?.length && v.statuses?.length), "İşletme listesi ya da durum filtresinden yalnızca birini seçin");

/** Örnek değişkenler (önizleme için; gerçek veri içermez). */
const SAMPLE: Record<string, string | number | boolean> = { fullName: "Ayşe Yılmaz", salon: "Örnek Güzellik", days: 3, minutes: 30, role: "personel", graceDays: 7, plan: "Profesyonel", amount: "1.000,00", until: "30.11.2026", active: 9, max: 8, description: "Kasım aboneliği", dueDate: "07.11.2026", payTo: "Şirket unvanı · IBAN", number: "ABC2026000000001", date: "30.10.2026", link: "https://proguzellik.com/panel/abonelik", complimentary: false, hours: 24, subject: "Planlı bakım duyurusu", body: "Pazar 02:00-03:00 arasında kısa bir bakım yapılacaktır.", code: "123456", firstName: "Ayşe", service: "Saç boyama", optOutLink: "https://proguzellik.com/r/ornek-guzellik/hatirlatma-kapat" };

@Controller("platform")
@PlatformAdmin()
export class PlatformEmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Gönderim geçmişi. Gövde ve şablon değişkenleri (kişisel veri/bağlantı içerebilir) dışarı verilmez. */
  @Get("emails")
  async history(@Query(new ZodPipe(historySchema)) q: z.infer<typeof historySchema>) {
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.template ? { template: q.template } : {}), ...(q.to ? { to: { contains: q.to.toLowerCase() } } : {}) };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.platform.outboundEmail.findMany({
        where, orderBy: { createdAt: "desc" }, take: q.take, skip: q.skip,
        select: { id: true, to: true, template: true, subject: true, status: true, provider: true, error: true, attempts: true, createdAt: true, sentAt: true, lastAttemptAt: true, tenantId: true, payload: true },
      }),
      this.prisma.platform.outboundEmail.count({ where }),
      this.prisma.platform.outboundEmail.groupBy({ by: ["status"], _count: true }),
    ]);
    return {
      total,
      delivery: { configured: this.email.deliveryConfigured },
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      items: items.map(({ payload, ...e }) => ({ ...e, retryable: e.status !== "SENT" && payload !== null && !TEMPLATE_META[e.template as TemplateName]?.secret })),
    };
  }

  @Post("emails/:id/retry")
  @HttpCode(200)
  async retry(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const r = await this.email.retry(id);
    await this.prisma.platform.auditLog.create({ data: { actorId: u.id, ip: req.ip, action: "platform.email_retried", entity: "OutboundEmail", entityId: id, metadata: { ok: "sent" in r } } });
    if ("failed" in r) throw new ServiceUnavailableException({ message: "E-posta yine gönderilemedi", code: r.code });
    return r;
  }

  @Get("email-templates")
  async templates() {
    const overrides = await this.prisma.platform.emailTemplateOverride.findMany();
    return Promise.all(
      (Object.keys(TEMPLATE_META) as TemplateName[]).map(async (name) => {
        const meta = TEMPLATE_META[name];
        // Varsayılan metin, değişkenler {yer tutucu} olarak kalacak şekilde üretilir (düzenleyicide başlangıç metni).
        const placeholders = { ...SAMPLE, payTo: undefined, ...Object.fromEntries(meta.vars.map((v) => [v, `{${v}}`])) };
        const def = await this.email.preview({ name, vars: placeholders } as unknown as EmailTemplate, null);
        const o = overrides.find((x) => x.name === name);
        return { name, ...meta, customized: !!o, subject: o?.subject ?? null, body: o?.body ?? null, defaultSubject: def.subject, defaultBody: def.body, updatedAt: o?.updatedAt ?? null };
      }),
    );
  }

  @Post("email-templates/:name/preview")
  @HttpCode(200)
  async preview(@Param("name") name: string, @Body(new ZodPipe(templateSchema.partial())) b: Partial<z.infer<typeof templateSchema>>) {
    const meta = TEMPLATE_META[name as TemplateName];
    if (!meta) throw new NotFoundException("Şablon bulunamadı");
    const r = await this.email.preview({ name, vars: SAMPLE } as unknown as EmailTemplate, b.subject && b.body ? { subject: b.subject, body: b.body } : undefined);
    return { subject: r.subject, html: r.html, text: r.text };
  }

  @Put("email-templates/:name")
  async saveTemplate(@CurrentUser() u: AuthUser, @Param("name") name: string, @Body(new ZodPipe(templateSchema)) b: z.infer<typeof templateSchema>, @Req() req: Request) {
    const meta = TEMPLATE_META[name as TemplateName];
    if (!meta) throw new NotFoundException("Şablon bulunamadı");
    if (!meta.editable) throw new ConflictException("Güvenlik e-postalarının metni değiştirilemez");
    const unknown = [...`${b.subject} ${b.body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !meta.vars.includes(v));
    if (unknown.length) throw new BadRequestException(`Bilinmeyen değişken: ${[...new Set(unknown)].map((v) => `{${v}}`).join(", ")}. Kullanılabilir: ${meta.vars.map((v) => `{${v}}`).join(", ")}`);
    const row = await this.prisma.platform.emailTemplateOverride.upsert({ where: { name }, create: { name, ...b, updatedById: u.id }, update: { ...b, updatedById: u.id } });
    await this.prisma.platform.auditLog.create({ data: { actorId: u.id, ip: req.ip, action: "platform.email_template_updated", entity: "EmailTemplateOverride", entityId: name } });
    return row;
  }

  @Delete("email-templates/:name")
  async resetTemplate(@CurrentUser() u: AuthUser, @Param("name") name: string, @Req() req: Request) {
    const r = await this.prisma.platform.emailTemplateOverride.deleteMany({ where: { name } });
    if (r.count) await this.prisma.platform.auditLog.create({ data: { actorId: u.id, ip: req.ip, action: "platform.email_template_reset", entity: "EmailTemplateOverride", entityId: name } });
    return { reset: r.count > 0 };
  }

  /**
   * Tekil ya da toplu hizmet bilgilendirmesi: işletmelerin aktif sahiplerine gider.
   * Ticari ileti (kampanya/reklam) için kullanılmaz. SMTP yoksa hiç gönderilmez (503).
   */
  @Post("emails/notice")
  async notice(@CurrentUser() u: AuthUser, @Body(new ZodPipe(noticeSchema)) b: z.infer<typeof noticeSchema>, @Req() req: Request) {
    if (!this.email.deliveryConfigured) throw new ServiceUnavailableException({ message: "E-posta (SMTP) yapılandırılmadı; bilgilendirme GÖNDERİLMEDİ.", code: "EMAIL_NOT_CONFIGURED" });
    const tenants = await this.prisma.platform.tenant.findMany({
      where: b.tenantIds?.length ? { id: { in: b.tenantIds } } : b.statuses?.length ? { status: { in: b.statuses } } : {},
      select: { id: true, name: true, memberships: { where: { role: "OWNER", isActive: true, user: { isActive: true, isPlatformAdmin: false } }, select: { user: { select: { email: true } } } } },
      take: 1000,
    });
    if (b.tenantIds?.length && tenants.length !== new Set(b.tenantIds).size) throw new NotFoundException("Seçilen işletmelerden biri bulunamadı");
    const recipients = tenants.flatMap((t) => t.memberships.map((m) => ({ tenantId: t.id, salon: t.name, email: m.user.email })));
    if (!recipients.length) throw new ConflictException("Seçime uyan aktif işletme sahibi yok");
    if (recipients.length > 500) throw new ConflictException(`Tek seferde en fazla 500 alıcı (seçim: ${recipients.length}); filtreyi daraltın`);
    let sent = 0, failed = 0, skipped = 0;
    for (const r of recipients) {
      const res = await this.email.send(r.email, { name: "owner_notice", vars: { subject: b.subject, body: b.body, salon: r.salon } }, { dedupeKey: `notice:${b.requestId}:${r.email}`, tenantId: r.tenantId, actorId: u.id });
      if ("sent" in res) sent++; else if ("skipped" in res) skipped++; else failed++;
    }
    await this.prisma.platform.auditLog.create({ data: { actorId: u.id, ip: req.ip, action: "platform.notice_sent", entity: "OutboundEmail", metadata: { subject: b.subject, recipients: recipients.length, sent, failed, skipped, requestId: b.requestId } } });
    return { recipients: recipients.length, sent, failed, skipped };
  }
}
