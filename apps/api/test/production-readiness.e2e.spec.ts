import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { createPlatformOwner, OwnerSetupError } from "../src/cli/create-owner.lib";
import { parseArgs } from "../src/cli/create-owner";
import { planMigrate } from "../src/cli/migrate";
import { loadEnv, productionIssues, registrationEnabled } from "../src/config/env";
import { createApp, createTenantWithUser, owner, registerTrial, resetDb } from "./helpers";

const validRegistration = {
  businessName: "Kapalı Kayıt Salonu",
  fullName: "Deneme Kişi",
  email: "kayit-kapali@test.local",
  password: "GucluParola123",
  kvkkAccepted: true,
};

describe("Canlıya hazırlık", () => {
  const su = owner();

  beforeAll(async () => {
    await resetDb(su);
  });
  afterAll(async () => {
    await su.$disconnect();
  });

  describe("işletme kaydı ayarı", () => {
    it("tanımsızsa canlıda kapalı, diğer ortamlarda açıktır; açık değer her zaman önceliklidir", () => {
      expect(registrationEnabled({ NODE_ENV: "production", REGISTRATION_ENABLED: undefined })).toBe(false);
      expect(registrationEnabled({ NODE_ENV: "development", REGISTRATION_ENABLED: undefined })).toBe(true);
      expect(registrationEnabled({ NODE_ENV: "test", REGISTRATION_ENABLED: undefined })).toBe(true);
      expect(registrationEnabled({ NODE_ENV: "production", REGISTRATION_ENABLED: "1" })).toBe(true);
      expect(registrationEnabled({ NODE_ENV: "production", REGISTRATION_ENABLED: "0" })).toBe(false);
      expect(registrationEnabled({ NODE_ENV: "development", REGISTRATION_ENABLED: "0" })).toBe(false);
    });

    it("canlıda kayıt açıksa env:check uyarır", () => {
      const env = { ...loadEnv(), REGISTRATION_ENABLED: "1" as const };
      expect(productionIssues(env, {}).some((i) => i.level === "warn" && /REGISTRATION_ENABLED/.test(i.message))).toBe(true);
      const closed = { ...loadEnv(), REGISTRATION_ENABLED: undefined };
      expect(productionIssues(closed, {}).some((i) => /REGISTRATION_ENABLED/.test(i.message))).toBe(false);
    });

    describe("API", () => {
      let app: INestApplication;
      const env = loadEnv();
      const original = env.REGISTRATION_ENABLED;
      const http = () => request(app.getHttpServer());

      beforeAll(async () => {
        app = await createApp();
      });
      afterAll(async () => {
        env.REGISTRATION_ENABLED = original;
        await app.close();
      });

      it("kapalıyken kayıt 403 döner, gövde doğrulanmaz ve hiçbir kayıt oluşmaz", async () => {
        env.REGISTRATION_ENABLED = "0";
        const before = await su.tenant.count();
        expect((await http().get("/auth/registration").expect(200)).body).toEqual({ enabled: false });
        const r = await http().post("/auth/register").send(validRegistration).expect(403);
        expect(r.body.message).toMatch(/kapalı/);
        await http().post("/auth/register").send({ junk: true }).expect(403);
        expect(await su.tenant.count()).toBe(before);
        expect(await su.user.findUnique({ where: { email: validRegistration.email } })).toBeNull();
      });

      it("açıkken kayıt çalışır", async () => {
        env.REGISTRATION_ENABLED = "1";
        expect((await http().get("/auth/registration").expect(200)).body).toEqual({ enabled: true });
        await registerTrial(app, validRegistration);
        expect(await su.user.findUnique({ where: { email: validRegistration.email } })).not.toBeNull();
      });
    });
  });

  describe("ilk platform sahibi (create-owner)", () => {
    const platform = new PrismaClient({ datasourceUrl: process.env.PLATFORM_DATABASE_URL });
    const PASSWORD = "SahipParola2026x";

    beforeEach(async () => {
      await resetDb(su);
    });
    afterAll(async () => {
      await platform.$disconnect();
    });

    it("platform rolüyle sahibi oluşturur; işletme veya demo verisi oluşturmaz, parola hash'lenir", async () => {
      const r = await createPlatformOwner(platform, { email: "  Sahip@Ornek.com ", fullName: "Sahip Kişi", password: PASSWORD });
      expect(r.status).toBe("created");
      const u = await su.user.findUniqueOrThrow({ where: { email: "sahip@ornek.com" } });
      expect(u.isPlatformAdmin).toBe(true);
      expect(u.emailVerifiedAt).not.toBeNull();
      expect(u.mfaEnabledAt).toBeNull();
      expect(u.passwordHash).not.toContain(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, u.passwordHash)).toBe(true);
      expect(await su.tenant.count()).toBe(0);
      expect(await su.membership.count()).toBe(0);
      expect(await su.auditLog.count({ where: { action: "platform.owner_created", entityId: u.id } })).toBe(1);
    });

    it("tekrar çalıştırıldığında çoğaltmaz ve mevcut hesabı (parolayı) değiştirmez", async () => {
      await createPlatformOwner(platform, { email: "sahip@ornek.com", fullName: "Sahip Kişi", password: PASSWORD });
      const before = await su.user.findUniqueOrThrow({ where: { email: "sahip@ornek.com" } });
      const r = await createPlatformOwner(platform, { email: "sahip@ornek.com", fullName: "Başka Ad", password: "BaskaParola999" });
      expect(r.status).toBe("exists");
      const after = await su.user.findUniqueOrThrow({ where: { email: "sahip@ornek.com" } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.fullName).toBe("Sahip Kişi");
      expect(await su.user.count({ where: { isPlatformAdmin: true } })).toBe(1);
    });

    it("eşzamanlı çalıştırmalarda tek hesap oluşur", async () => {
      const input = { email: "sahip@ornek.com", fullName: "Sahip Kişi", password: PASSWORD };
      const results = await Promise.all([createPlatformOwner(platform, input), createPlatformOwner(platform, input)]);
      expect(results.map((r) => r.status).sort()).toEqual(["created", "exists"]);
      expect(await su.user.count({ where: { isPlatformAdmin: true } })).toBe(1);
    });

    it("başka bir platform sahibi varsa --additional olmadan ikinci hesap açmaz", async () => {
      await createPlatformOwner(platform, { email: "sahip@ornek.com", fullName: "Sahip Kişi", password: PASSWORD });
      await expect(createPlatformOwner(platform, { email: "ikinci@ornek.com", fullName: "İkinci Kişi", password: PASSWORD })).rejects.toThrow(OwnerSetupError);
      expect(await su.user.count()).toBe(1);
      const r = await createPlatformOwner(platform, { email: "ikinci@ornek.com", fullName: "İkinci Kişi", password: PASSWORD }, { allowAdditional: true });
      expect(r.status).toBe("created");
      expect(await su.user.count({ where: { isPlatformAdmin: true } })).toBe(2);
    });

    it("sıradan kullanıcının yetkisini yükseltmez", async () => {
      await createTenantWithUser(su, { name: "Salon", email: "isletme@ornek.com" });
      await expect(createPlatformOwner(platform, { email: "isletme@ornek.com", fullName: "Sahip Kişi", password: PASSWORD })).rejects.toThrow(/yetki yükseltilmedi/);
      expect((await su.user.findUniqueOrThrow({ where: { email: "isletme@ornek.com" } })).isPlatformAdmin).toBe(false);
    });

    it("zayıf parolayı ve demo/test e-postalarını reddeder", async () => {
      await expect(createPlatformOwner(platform, { email: "sahip@ornek.com", fullName: "Sahip Kişi", password: "kisa1" })).rejects.toThrow(/10 karakter/);
      await expect(createPlatformOwner(platform, { email: "sahip@ornek.com", fullName: "Sahip Kişi", password: "sadeceharfler" })).rejects.toThrow(/rakam/);
      await expect(createPlatformOwner(platform, { email: "owner@proguzellik.local", fullName: "Sahip Kişi", password: PASSWORD })).rejects.toThrow(/Demo/);
      expect(await su.user.count()).toBe(0);
    });

    it("parola komut satırından kabul edilmez", () => {
      expect(parseArgs(["--email", "a@b.com", "--name", "Ad Soyad"])).toEqual({ email: "a@b.com", name: "Ad Soyad", additional: false });
      expect(() => parseArgs(["--email", "a@b.com", "--name", "Ad", "--password", "x"])).toThrow(/komut satırında/);
      expect(() => parseArgs(["--email", "a@b.com", "--name", "Ad", "--password=x"])).toThrow(/komut satırında/);
      expect(() => parseArgs(["--email", "a@b.com"])).toThrow(/Kullanım/);
    });
  });

  describe("migration aracı", () => {
    const ownerUrl = "postgresql://proguzellik_owner:x@db:5432/proguzellik";

    it("status salt okunurdur; deploy yalnızca --confirm ile çalışır", () => {
      expect(planMigrate(["status"], { DATABASE_URL: ownerUrl })).toEqual({ cmd: "status", target: "db:5432/proguzellik" });
      expect(() => planMigrate(["deploy"], { DATABASE_URL: ownerUrl })).toThrow(/--confirm/);
      expect(planMigrate(["deploy", "--confirm"], { DATABASE_URL: ownerUrl }).cmd).toBe("deploy");
    });

    it("DATABASE_URL yoksa, uygulama rolüyse ya da komut bilinmiyorsa reddeder", () => {
      expect(() => planMigrate(["deploy", "--confirm"], {})).toThrow(/DATABASE_URL/);
      expect(() => planMigrate(["deploy", "--confirm"], { DATABASE_URL: "postgresql://app_tenant:x@db/proguzellik" })).toThrow(/uygulama rolleri/);
      expect(() => planMigrate(["deploy", "--confirm"], { DATABASE_URL: "postgresql://app_platform:x@db/proguzellik" })).toThrow(/uygulama rolleri/);
      expect(() => planMigrate(["reset"], { DATABASE_URL: ownerUrl })).toThrow(/Kullanım/);
      expect(() => planMigrate(["deploy", "--confirm", "--force"], { DATABASE_URL: ownerUrl })).toThrow(/Bilinmeyen/);
    });

    it("API başlangıcı migration çalıştırmaz", () => {
      const main = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../src/main.ts"), "utf8");
      expect(main).not.toMatch(/migrate|prisma\/build|execSync|spawn/);
    });
  });
});
