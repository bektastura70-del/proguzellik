import { expect, test } from "@playwright/test";
import { apiGet, authFile } from "./helpers";

/** Tarayıcı üzerinden yetki ve kiracı izolasyonu kontrolleri (API vekili dahil). */
test.describe("Oturum ve erişim", () => {
  test("oturumsuz kullanıcı panele ve yönetime giremez", async ({ page }) => {
    await page.goto("/panel/kasa");
    await expect(page).toHaveURL(/\/giris\?donus=%2Fpanel%2Fkasa/);
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/giris\?donus=%2Fplatform/);
    const res = await page.request.get("/api/p/customers");
    expect(res.status()).toBe(401);
  });

  test("başka kökenden gelen durum değiştiren istek reddedilir (CSRF koruması)", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("owner") });
    const res = await ctx.request.post("/api/p/customers", {
      headers: { Origin: "https://kotu-site.example" },
      data: { firstName: "CSRF", lastName: "Deneme" },
    });
    expect(res.status()).toBe(403);
    await ctx.close();
  });

  test("güvenlik başlıkları gönderilir", async ({ page }) => {
    const res = await page.goto("/giris");
    const h = res!.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("oturum çerezi JavaScript'e kapalıdır (httpOnly)", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("owner") });
    const page = await ctx.newPage();
    await page.goto("/panel");
    expect(await page.evaluate(() => document.cookie)).not.toContain("pg_token");
    const cookie = (await ctx.cookies()).find((c) => c.name === "pg_token")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    await ctx.close();
  });
});

test.describe("Kiracı izolasyonu (tarayıcıdan)", () => {
  test("başka işletmenin kimliği başlıkla gönderilse de veri alınamaz", async ({ browser }) => {
    const owner = await browser.newContext({ storageState: authFile("owner") });
    const op = await owner.newPage();
    await op.goto("/panel");
    const me = await apiGet<{ memberships: { tenant: { id: string } }[] }>(op, "/auth/me");
    const demoTenant = me.memberships[0].tenant.id;
    const customers = await apiGet<{ items: { id: string }[] }>(op, "/customers");
    const demoCustomer = customers.items[0].id;
    await owner.close();

    const other = await browser.newContext({ storageState: authFile("other") });
    const p = await other.newPage();
    const r1 = await p.request.get("/api/p/customers", { headers: { "X-Tenant-Id": demoTenant } });
    expect(r1.status()).toBe(403);
    const r2 = await p.request.get(`/api/p/customers/${demoCustomer}`);
    expect(r2.status()).toBe(404);
    const r3 = await p.request.get("/api/p/customers");
    const own = (await r3.json()) as { items: { firstName: string }[] };
    expect(own.items.map((c) => c.firstName)).toEqual(["Başka"]);
    await other.close();
  });
});

test.describe("Rol bazlı yetkilendirme", () => {
  test("personel (STAFF): kasa/rapor/ayar menüsü yok, API'de de yasak", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("staff") });
    const page = await ctx.newPage();
    await page.goto("/panel");
    for (const name of ["Kasa", "Raporlar", "Ayarlar", "Hizmetler", "Personel", "Abonelik"]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    for (const path of ["/finance/summary?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z", "/team", "/reports/dashboard?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z"]) {
      expect((await page.request.get(`/api/p${path}`)).status(), path).toBe(403);
    }
    const create = await page.request.post("/api/p/customers/00000000-0000-0000-0000-000000000000/anonymize");
    expect(create.status()).toBe(403);
    await ctx.close();
  });

  test("resepsiyon: tahsilat alabilir, iade ve gider ekleyemez", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("reception") });
    const page = await ctx.newPage();
    await page.goto("/panel/kasa");
    await expect(page.getByRole("button", { name: "Gider ekle" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "İade" })).toHaveCount(0);
    const res = await page.request.post("/api/p/finance/transactions", { data: { type: "EXPENSE", category: "X", amount: 1, method: "CASH" } });
    expect(res.status()).toBe(403);
    await ctx.close();
  });
});
