import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { lineAmounts } from "../src/platform/finance/money";
import { toCsv } from "../src/platform/finance/finance.service";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

const DAY = 86_400_000;
const rid = () => randomUUID();

describe("Para hesapları (birim)", () => {
  it("KDV dahil/haric satır tutarları 2 ondalıkla yuvarlanır", () => {
    const inc = lineAmounts(1, 1000, 20, true);
    expect([inc.net.toFixed(2), inc.vat.toFixed(2), inc.gross.toFixed(2)]).toEqual(["833.33", "166.67", "1000.00"]);
    const exc = lineAmounts(3, 99.99, 20, false);
    expect([exc.net.toFixed(2), exc.vat.toFixed(2), exc.gross.toFixed(2)]).toEqual(["299.97", "59.99", "359.96"]);
  });

  it("CSV formül enjeksiyonunu engeller, ayraç ve tırnakları kaçışlar", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(\"x\")", "-12,5"], ["x;y", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")";-12,5`);
    expect(csv).toContain(`"x;y";`);
  });
});

describe("SaaS sahibi muhasebesi", () => {
  const su = owner();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  const entry = (body: Record<string, unknown>) => admin.post("/platform/finance/entries").send({ tenantId: A.tenant.id, requestId: rid(), ...body });

  beforeAll(async () => {
    await resetDb(su);
    await su.platformCompany.deleteMany();
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    await su.user.create({ data: { email: "admin@proguzellik.test", fullName: "Sahip", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  describe("yetki ve izolasyon", () => {
    it("işletme sahibi SaaS muhasebesine erişemez; oturumsuz istek 401", async () => {
      const a = api(app, await login(app, "a@test.local"), A.tenant.id);
      for (const p of ["/platform/company", "/platform/finance/accounts", `/platform/finance/tenants/${A.tenant.id}/ledger`, "/platform/finance/report?year=2026", "/platform/invoices"]) await a.get(p).expect(403);
      await a.post("/platform/finance/entries").send({ tenantId: A.tenant.id, type: "PAYMENT", amount: 1, description: "Sahte", method: "CASH", requestId: rid() }).expect(403);
      await request(app.getHttpServer()).get("/platform/finance/accounts").expect(401);
    });

    it("işletme veritabanı rolü SaaS muhasebe tablolarını okuyamaz", async () => {
      const prisma = app.get(PrismaService);
      await expect(prisma.withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => tx.platformLedgerEntry.findMany())).rejects.toThrow(/permission denied/);
      await expect(prisma.withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => tx.platformInvoice.findMany())).rejects.toThrow(/permission denied/);
      await expect(prisma.withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => tx.platformCompany.findMany())).rejects.toThrow(/permission denied/);
    });
  });

  describe("şirket ayarları", () => {
    it("bilgiler boş başlar; SMTP bilgisi yalnızca durum olarak döner", async () => {
      const r = await admin.get("/platform/company").expect(200);
      expect(r.body.company).toMatchObject({ legalName: null, taxNumber: null, vatRate: null, pricesIncludeVat: null });
      expect(r.body.email).toMatchObject({ mode: "mock", smtpConfigured: false });
      expect(JSON.stringify(r.body)).not.toMatch(/SMTP_URL|smtp:\/\//);
      expect(r.body.einvoice).toEqual({ provider: "none", configured: false });
    });

    it("geçersiz VKN/IBAN reddedilir; kayıt denetime maskeli yazılır", async () => {
      await admin.put("/platform/company").send({ taxNumber: "123" }).expect(400);
      await admin.put("/platform/company").send({ iban: "DE00123" }).expect(400);
      await admin.put("/platform/company").send({ vatRate: 120 }).expect(400);
      const r = await admin.put("/platform/company").send({ legalName: "Örnek Yazılım Ltd. Şti.", taxNumber: "1234567890", taxOffice: "Kadıköy", address: "İstanbul", iban: "TR33 0006 1005 1978 6457 8413 26" }).expect(200);
      expect(r.body.iban).toBe("TR330006100519786457841326");
      const log = await su.auditLog.findFirstOrThrow({ where: { action: "platform.company_updated" } });
      expect(JSON.stringify(log.metadata)).not.toContain("1234567890");
      expect(JSON.stringify(log.metadata)).not.toContain("TR330006100519786457841326");
    });
  });

  describe("cari hesap", () => {
    let accrual: string;
    let payment: string;

    it("tahakkuk, kısmi tahsilat ve fazla tahsilat engeli", async () => {
      accrual = (await entry({ type: "ACCRUAL", amount: 1000, description: "Ekim aboneliği", dueDate: new Date(Date.now() - DAY).toISOString() }).expect(201)).body.id;
      payment = (await entry({ type: "PAYMENT", amount: 400, description: "Havale", method: "BANK_TRANSFER", relatedEntryId: accrual }).expect(201)).body.id;
      let l = (await admin.get(`/platform/finance/tenants/${A.tenant.id}/ledger`).expect(200)).body;
      expect(l.entries.find((e: { id: string }) => e.id === accrual)).toMatchObject({ state: "PARTIAL", paid: "400.00", open: "600.00" });
      expect(l.totals.balance).toBe("600.00");
      await entry({ type: "PAYMENT", amount: 700, description: "Fazla", method: "CASH", relatedEntryId: accrual }).expect(409);
      await entry({ type: "ACCRUAL_CANCEL", amount: 700, description: "İptal", relatedEntryId: accrual }).expect(409);
      await entry({ type: "PAYMENT", amount: 600, description: "Kalan", method: "CARD", relatedEntryId: accrual }).expect(201);
      l = (await admin.get(`/platform/finance/tenants/${A.tenant.id}/ledger`).expect(200)).body;
      expect(l.entries.find((e: { id: string }) => e.id === accrual)).toMatchObject({ state: "PAID", open: "0.00" });
      expect(l.totals.balance).toBe("0.00");
    });

    it("iade tahsilatla sınırlıdır ve bakiyeye geri eklenir", async () => {
      await entry({ type: "REFUND", amount: 150, description: "Kısmi iade", method: "BANK_TRANSFER", relatedEntryId: payment }).expect(201);
      await entry({ type: "REFUND", amount: 300, description: "Fazla iade", method: "BANK_TRANSFER", relatedEntryId: payment }).expect(409);
      await entry({ type: "REFUND", amount: 10, description: "Yanlış bağlantı", method: "BANK_TRANSFER", relatedEntryId: accrual }).expect(400);
      const l = (await admin.get(`/platform/finance/tenants/${A.tenant.id}/ledger`).expect(200)).body;
      expect(l.totals).toMatchObject({ collected: "1000.00", refunded: "150.00", netCollected: "850.00", balance: "150.00" });
    });

    it("tekrar istek ikinci kayıt oluşturmaz; eşzamanlı fazla tahsilatlardan yalnızca biri geçer", async () => {
      const acc = (await entry({ type: "ACCRUAL", amount: 500, description: "Kasım" }).expect(201)).body.id;
      const requestId = rid();
      const body = { tenantId: A.tenant.id, type: "PAYMENT", amount: 100, description: "Tekrar", method: "CASH", relatedEntryId: acc, requestId };
      await admin.post("/platform/finance/entries").send(body).expect(201);
      const again = await admin.post("/platform/finance/entries").send(body).expect(200);
      expect(again.body.replayed).toBe(true);
      await admin.post("/platform/finance/entries").send({ ...body, amount: 200 }).expect(409);
      expect(await su.platformLedgerEntry.count({ where: { requestId } })).toBe(1);
      const results = await Promise.all(Array.from({ length: 5 }, () => entry({ type: "PAYMENT", amount: 400, description: "Yarış", method: "CASH", relatedEntryId: acc })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });

    it("başka işletmenin kaydına bağlanamaz", async () => {
      await admin.post("/platform/finance/entries").send({ tenantId: B.tenant.id, type: "PAYMENT", amount: 10, description: "Çapraz", method: "CASH", relatedEntryId: accrual, requestId: rid() }).expect(404);
    });

    it("manuel ücretsiz abonelik gelir kaydı oluşturmaz ve tahakkuk bağlanamaz", async () => {
      const before = await su.platformLedgerEntry.count();
      const sub = (await admin.post(`/platform/tenants/${B.tenant.id}/subscriptions`).send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", complimentary: true, note: "Açılış hediyesi", requestId: rid() }).expect(200)).body;
      expect(await su.platformLedgerEntry.count()).toBe(before);
      const subId = sub.id ?? sub.subscription?.id;
      await admin.post("/platform/finance/entries").send({ tenantId: B.tenant.id, type: "ACCRUAL", amount: 999, description: "Yanlış", subscriptionId: subId, requestId: rid() }).expect(409);
      await expect(su.platformLedgerEntry.create({ data: { tenantId: B.tenant.id, type: "ACCRUAL", amount: 1, description: "x", occurredAt: new Date(), subscriptionId: subId, requestId: rid(), actorId: B.user.id } })).rejects.toThrow(/Ücretsiz/);
      const r = (await admin.get("/platform/finance/report?year=" + new Date().getFullYear()).expect(200)).body;
      expect(r.totals.complimentaryGrants).toBeGreaterThanOrEqual(1);
    });

    it("cari kayıt veritabanında değiştirilemez/silinemez", async () => {
      await expect(su.platformLedgerEntry.update({ where: { id: accrual }, data: { amount: 1 } })).rejects.toThrow(/değiştirilemez/);
      await expect(su.platformLedgerEntry.delete({ where: { id: accrual } })).rejects.toThrow();
    });

    it("cari özet: alacak ve vadesi geçen; tahakkuk iptali", async () => {
      const acc = (await entry({ type: "ACCRUAL", amount: 250, description: "Vadesi geçmiş", dueDate: new Date(Date.now() - 2 * DAY).toISOString() }).expect(201)).body.id;
      let s = (await admin.get("/platform/finance/accounts").expect(200)).body;
      const row = s.rows.find((r: { tenant: { id: string } }) => r.tenant.id === A.tenant.id);
      expect(row.overdue).toBe("250.00");
      await entry({ type: "ACCRUAL_CANCEL", amount: 250, description: "Yanlış tahakkuk", relatedEntryId: acc }).expect(201);
      s = (await admin.get("/platform/finance/accounts").expect(200)).body;
      expect(s.rows.find((r: { tenant: { id: string } }) => r.tenant.id === A.tenant.id).overdue).toBe("0.00");
      expect(Number(s.totals.receivable)).toBeGreaterThan(0);
    });

    it("gelir raporu ve CSV", async () => {
      const year = new Date().getFullYear();
      const r = (await admin.get(`/platform/finance/report?year=${year}`).expect(200)).body;
      expect(r.rows).toHaveLength(12);
      expect(r.totals).toMatchObject({ collected: "1500.00", refunded: "150.00", netCollected: "1350.00" });
      const y = (await admin.get(`/platform/finance/report?year=${year}&granularity=year`).expect(200)).body;
      expect(y.rows).toHaveLength(1);
      expect(y.rows[0].pendingAtEnd).toBe(r.totals.pending);
      const csv = await admin.get(`/platform/finance/report.csv?year=${year}`).expect(200);
      expect(csv.headers["content-type"]).toMatch(/text\/csv/);
      expect(csv.text.split("\r\n")[0]).toBe("﻿Dönem;Tahakkuk;Tahsilat;İade;Net tahsilat;Online tahsilat;Dönem sonu bekleyen;Ücretsiz tanımlama (adet)");
      const lcsv = await admin.get(`/platform/finance/tenants/${A.tenant.id}/ledger.csv`).expect(200);
      expect(lcsv.text).toContain("Tahsilat");
    });
  });

  describe("fatura taslakları", () => {
    let acc: string;
    let inv: { id: string; draftNo: string };

    it("eksik şirket/KDV/alıcı bilgisiyle taslak oluşmaz", async () => {
      acc = (await entry({ type: "ACCRUAL", amount: 1000, description: "Aralık aboneliği" }).expect(201)).body.id;
      const r = await admin.post("/platform/invoices").send({ tenantId: A.tenant.id, accrualId: acc }).expect(422);
      expect(r.body.missing).toEqual(expect.arrayContaining(["KDV oranı", "fiyatların KDV durumu", "işletmenin fatura bilgileri"]));
    });

    it("taslak tahakkuktan oluşturulur; mali belge değildir; aynı tahakkuka ikinci taslak açılmaz", async () => {
      await admin.put("/platform/company").send({ vatRate: 20, pricesIncludeVat: true }).expect(200);
      await admin.put(`/platform/tenants/${A.tenant.id}/billing-profile`).send({ legalName: "Salon A Güzellik Ltd.", taxNumber: "9876543210", taxOffice: "Beşiktaş", address: "İstanbul" }).expect(200);
      await admin.put(`/platform/tenants/${A.tenant.id}/billing-profile`).send({ legalName: "X", taxNumber: "12" }).expect(400);
      const r = await admin.post("/platform/invoices").send({ tenantId: A.tenant.id, accrualId: acc }).expect(201);
      inv = r.body;
      expect(r.body).toMatchObject({ status: "DRAFT", officialNumber: null, netTotal: "833.33", vatTotal: "166.67", grossTotal: "1000" });
      expect(r.body.draftNo).toMatch(/^TASLAK-\d{4}-\d{6}$/);
      expect(r.body.buyer).toMatchObject({ legalName: "Salon A Güzellik Ltd." });
      expect((await admin.get(`/platform/invoices/${inv.id}`).expect(200)).body.isFiscalDocument).toBe(false);
      await admin.post("/platform/invoices").send({ tenantId: A.tenant.id, accrualId: acc }).expect(409);
    });

    it("taslak düzenlenir; entegratör yoksa resmî fatura kesilmez", async () => {
      const u = await admin.patch(`/platform/invoices/${inv.id}`).send({ lines: [{ description: "Abonelik", quantity: 1, unitPrice: 600 }, { description: "Kurulum", quantity: 2, unitPrice: 200 }] }).expect(200);
      expect(u.body.grossTotal).toBe("1000");
      expect(u.body.lines).toHaveLength(2);
      const r = await admin.post(`/platform/invoices/${inv.id}/issue`).expect(503);
      expect(r.body.code).toBe("EINVOICE_NOT_CONFIGURED");
      const after = await su.platformInvoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after).toMatchObject({ status: "DRAFT", officialNumber: null });
      expect(await su.auditLog.count({ where: { action: "platform.invoice_issue_blocked", entityId: inv.id } })).toBe(1);
    });

    it("başka sistemde kesilen fatura kaydedilir; sonra içeriği değiştirilemez; iptal edilir", async () => {
      await admin.post(`/platform/invoices/${inv.id}/record`).send({ officialNumber: "kisa", issueDate: new Date().toISOString() }).expect(400);
      const r = await admin.post(`/platform/invoices/${inv.id}/record`).send({ officialNumber: "ABC2026000000001", issueDate: new Date().toISOString() }).expect(200);
      expect(r.body).toMatchObject({ status: "RECORDED", officialNumber: "ABC2026000000001" });
      await admin.patch(`/platform/invoices/${inv.id}`).send({ lines: [{ description: "Değişiklik", quantity: 1, unitPrice: 1 }] }).expect(409);
      await expect(su.platformInvoice.update({ where: { id: inv.id }, data: { grossTotal: 1, netTotal: 1, vatTotal: 0 } })).rejects.toThrow(/Kesinleşmiş/);
      await expect(su.platformInvoiceLine.deleteMany({ where: { invoiceId: inv.id } })).rejects.toThrow(/taslak/);
      await expect(su.platformInvoice.delete({ where: { id: inv.id } })).rejects.toThrow();
      await admin.post(`/platform/invoices/${inv.id}/cancel`).send({ reason: "Hatalı tutar" }).expect(200);
      await admin.post(`/platform/invoices/${inv.id}/cancel`).send({ reason: "Tekrar" }).expect(409);
      // İptalden sonra aynı tahakkuka yeni taslak açılabilir
      await admin.post("/platform/invoices").send({ tenantId: A.tenant.id, accrualId: acc }).expect(201);
      expect((await admin.get(`/platform/invoices?tenantId=${A.tenant.id}`).expect(200)).body).toHaveLength(2);
    });
  });
});
