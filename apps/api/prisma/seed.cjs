/**
 * YEREL DEMO VERİSİ — yalnızca geliştirme veritabanı için.
 * Tüm kişiler ve telefon numaraları uydurmadır (gerçek müşteri verisi yoktur).
 * Çalıştırma: pnpm --filter @proguzellik/api db:seed
 */
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const envFile = resolve(__dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Demo verisi yalnızca yerel veritabanına yüklenebilir.");
  process.exit(1);
}

const db = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD || "Demo12345!";
const SLUG = "isilti-guzellik";
const DAY = 86_400_000;
const mod = (x, n) => ((x % n) + n) % n;

/** İstanbul (UTC+3) yerel gün/saat → Date */
function at(daysFromToday, hh, mm = 0) {
  const now = new Date(Date.now() + 3 * 3_600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday, hh - 3, mm));
  return d;
}

async function main() {
  if (await db.tenant.findUnique({ where: { slug: SLUG } })) {
    console.log("Demo verisi zaten yüklü. Yeniden yüklemek için demo işletmesini silin.");
    return;
  }
  const hash = await bcrypt.hash(PASSWORD, 12);

  await db.user.upsert({
    where: { email: "owner@proguzellik.local" },
    update: {},
    create: { email: "owner@proguzellik.local", fullName: "Platform Yöneticisi", passwordHash: hash, isPlatformAdmin: true, emailVerifiedAt: new Date() },
  });

  const tenant = await db.tenant.create({
    data: {
      name: "Işıltı Güzellik Stüdyosu", slug: SLUG, status: "TRIAL", planCode: "SMART",
      trialEndsAt: new Date(Date.now() + 14 * DAY), phone: "02120000000", email: "demo@proguzellik.local", address: "Örnek Mah. Deneme Sok. No:1, İstanbul",
    },
  });
  const T = tenant.id;
  const owner = await db.user.create({ data: { email: "demo@proguzellik.local", fullName: "Deniz Demo", passwordHash: hash, emailVerifiedAt: new Date() } });
  const reception = await db.user.create({ data: { email: "resepsiyon@proguzellik.local", fullName: "Rana Resepsiyon", passwordHash: hash, emailVerifiedAt: new Date() } });
  const elifUser = await db.user.create({ data: { email: "elif@proguzellik.local", fullName: "Elif Uzman", passwordHash: hash, emailVerifiedAt: new Date() } });
  await db.membership.createMany({
    data: [
      { tenantId: T, userId: owner.id, role: "OWNER" },
      { tenantId: T, userId: reception.id, role: "RECEPTION" },
      { tenantId: T, userId: elifUser.id, role: "STAFF" },
    ],
  });

  const [cilt, epilasyon, tirnak] = await Promise.all(
    ["Cilt Bakımı", "Epilasyon", "Tırnak & Kirpik"].map((name, i) => db.serviceCategory.create({ data: { tenantId: T, name, sortOrder: i } })),
  );
  const svc = async (categoryId, name, durationMin, price, color) => db.service.create({ data: { tenantId: T, categoryId, name, durationMin, price, color } });
  const s1 = await svc(cilt.id, "Klasik Cilt Bakımı", 60, 900, "#b0507b");
  const s2 = await svc(cilt.id, "Hydrafacial", 75, 1600, "#7c5cbf");
  const s3 = await svc(epilasyon.id, "Lazer Epilasyon – Tüm Bacak", 45, 1200, "#d97706");
  const s4 = await svc(tirnak.id, "Kalıcı Oje", 45, 450, "#0e7490");
  const s5 = await svc(tirnak.id, "Kirpik Lifting", 60, 750, "#15803d");

  const staff = async (displayName, title, color, rate, services, userId) => {
    const s = await db.staffMember.create({ data: { tenantId: T, displayName, title, color, commissionRate: rate, userId } });
    await db.staffService.createMany({ data: services.map((x) => ({ tenantId: T, staffId: s.id, serviceId: x.id })) });
    await db.workingHour.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: T, staffId: s.id, weekday, startMin: 540, endMin: 1140 })) });
    return s;
  };
  const elif = await staff("Elif", "Cilt bakım uzmanı", "#b0507b", 15, [s1, s2], elifUser.id);
  const merve = await staff("Merve", "Lazer uzmanı", "#d97706", 12, [s3, s1], null);
  const selin = await staff("Selin", "Tırnak & kirpik uzmanı", "#0e7490", 20, [s4, s5], null);

  const product = (data) => db.product.create({ data: { tenantId: T, ...data } });
  const jel = await product({ name: "Lazer Jeli", sku: "SARF-001", unit: "ml", kind: "CONSUMABLE", stockQty: 2400, minQty: 500, costPrice: 0.4 });
  const maske = await product({ name: "Yüz Maskesi", sku: "SARF-002", unit: "adet", kind: "CONSUMABLE", stockQty: 6, minQty: 10, costPrice: 35 });
  await product({ name: "Nemlendirici Krem 50 ml", sku: "SAT-001", unit: "adet", kind: "RETAIL", stockQty: 14, minQty: 5, costPrice: 220, salePrice: 480 });
  await product({ name: "Güneş Kremi SPF50", sku: "SAT-002", unit: "adet", kind: "RETAIL", stockQty: 3, minQty: 5, costPrice: 260, salePrice: 590 });
  await db.serviceConsumable.createMany({
    data: [
      { tenantId: T, serviceId: s3.id, productId: jel.id, qty: 60 },
      { tenantId: T, serviceId: s1.id, productId: maske.id, qty: 1 },
    ],
  });

  const tpl = await db.packageTemplate.create({ data: { tenantId: T, serviceId: s3.id, name: "6 Seans Lazer – Tüm Bacak", sessionCount: 6, price: 5400, validityDays: 365 } });
  await db.packageTemplate.create({ data: { tenantId: T, serviceId: s1.id, name: "4 Seans Cilt Bakımı", sessionCount: 4, price: 3000, validityDays: 120 } });

  const names = [
    ["Ayşe", "Yılmaz"], ["Zeynep", "Kaya"], ["Fatma", "Demir"], ["Elif", "Şahin"], ["Merve", "Çelik"], ["Büşra", "Arslan"],
    ["Selin", "Koç"], ["Derya", "Aydın"], ["Gizem", "Öztürk"], ["Ece", "Kurt"], ["Nazlı", "Polat"], ["Sena", "Erdoğan"],
  ];
  const customers = [];
  for (const [i, [firstName, lastName]] of names.entries()) {
    customers.push(
      await db.customer.create({
        data: {
          tenantId: T, firstName, lastName, phone: `0555000${String(i + 1).padStart(4, "0")}`, source: i % 3 === 0 ? "ONLINE" : "PANEL",
          tags: i % 4 === 0 ? ["VIP"] : i % 5 === 0 ? ["Hassas cilt"] : [], kvkkConsentAt: new Date(Date.now() - (30 - i) * DAY), marketingConsent: i % 2 === 0,
          createdAt: new Date(Date.now() - (40 - i * 3) * DAY),
        },
      }),
    );
  }

  const pkg = await db.customerPackage.create({
    data: { tenantId: T, customerId: customers[0].id, templateId: tpl.id, serviceId: s3.id, name: tpl.name, totalSessions: 6, price: 5400, purchasedAt: new Date(Date.now() - 20 * DAY), expiresAt: new Date(Date.now() + 345 * DAY), createdById: owner.id },
  });
  await db.financeTransaction.create({ data: { tenantId: T, type: "INCOME", category: "PAKET_SATISI", amount: 3000, method: "CARD", customerId: customers[0].id, customerPackageId: pkg.id, occurredAt: new Date(Date.now() - 20 * DAY), createdById: owner.id, description: "Paket peşinatı" } });

  // Geçmiş 21 gün: tamamlanan randevular ve tahsilatlar
  const plan = [[elif, [s1, s2]], [merve, [s3, s1]], [selin, [s4, s5]]];
  let ci = 0;
  for (let d = -21; d <= -1; d++) {
    const wd = at(d, 12).getUTCDay();
    if (wd === 0) continue;
    for (const [st, svcs] of plan) {
      for (const hh of [10, 13, 16]) {
        if (mod(d + hh, 3) === 0) continue;
        const service = svcs[mod(d + hh, svcs.length)];
        const customer = customers[ci++ % customers.length];
        const usePkg = service.id === s3.id && customer.id === customers[0].id && d > -20;
        const startsAt = at(d, hh);
        const status = mod(d + hh, 11) === 0 ? "NO_SHOW" : mod(d + hh, 13) === 0 ? "CANCELLED" : "COMPLETED";
        const appt = await db.appointment.create({
          data: {
            tenantId: T, customerId: customer.id, staffId: st.id, serviceId: service.id, startsAt, endsAt: new Date(startsAt.getTime() + service.durationMin * 60000),
            price: usePkg ? 0 : service.price, status, source: ci % 4 === 0 ? "ONLINE" : "PANEL", createdById: reception.id, customerPackageId: usePkg ? pkg.id : null,
          },
        });
        if (status === "COMPLETED") {
          if (usePkg) {
            const p = await db.customerPackage.findUnique({ where: { id: pkg.id } });
            if (p.usedSessions < p.totalSessions) {
              await db.customerPackage.update({ where: { id: pkg.id }, data: { usedSessions: { increment: 1 } } });
              await db.sessionUsage.create({ data: { tenantId: T, customerPackageId: pkg.id, appointmentId: appt.id, staffId: st.id, usedAt: startsAt } });
            }
          } else if (ci % 6 !== 0) {
            await db.financeTransaction.create({
              data: { tenantId: T, type: "INCOME", category: "HIZMET", amount: service.price, method: ci % 3 === 0 ? "CASH" : "CARD", customerId: customer.id, appointmentId: appt.id, staffId: st.id, occurredAt: new Date(startsAt.getTime() + service.durationMin * 60000), createdById: reception.id },
            });
          }
        }
      }
    }
  }
  // Giderler
  for (const [d, category, amount] of [[-18, "KIRA", 25000], [-12, "MALZEME", 4200], [-5, "FATURA", 1850]]) {
    await db.financeTransaction.create({ data: { tenantId: T, type: "EXPENSE", category, amount, method: "TRANSFER", occurredAt: at(d, 11), createdById: owner.id } });
  }
  // Bugün ve önümüzdeki 7 gün: bekleyen randevular
  for (let d = 0; d <= 7; d++) {
    if (at(d, 12).getUTCDay() === 0) continue;
    for (const [i, [st, svcs]] of plan.entries()) {
      for (const hh of [11, 15]) {
        if (mod(d + i + hh, 4) === 0) continue;
        const service = svcs[mod(d + hh, svcs.length)];
        const customer = customers[(d * 3 + i + hh) % customers.length];
        const startsAt = at(d, hh, i * 15);
        await db.appointment.create({
          data: { tenantId: T, customerId: customer.id, staffId: st.id, serviceId: service.id, startsAt, endsAt: new Date(startsAt.getTime() + service.durationMin * 60000), price: service.price, status: d === 0 ? "CONFIRMED" : "BOOKED", source: (d + i) % 3 === 0 ? "ONLINE" : "PANEL", createdById: reception.id },
        });
      }
    }
  }
  await db.customerNote.create({ data: { tenantId: T, customerId: customers[4].id, authorId: owner.id, body: "Hassas cilt; alkol içeren ürün kullanılmamalı." } });

  // İkinci örnek işletme (izolasyonu panelde görmek için)
  const other = await db.tenant.create({ data: { name: "Örnek Kuaför", slug: "ornek-kuafor", status: "ACTIVE", planCode: "STARTER", trialEndsAt: new Date(Date.now() - DAY) } });
  const otherOwner = await db.user.create({ data: { email: "kuafor@proguzellik.local", fullName: "Kuaför Sahibi", passwordHash: hash, emailVerifiedAt: new Date() } });
  await db.membership.create({ data: { tenantId: other.id, userId: otherOwner.id, role: "OWNER" } });
  await db.customer.create({ data: { tenantId: other.id, firstName: "Başka", lastName: "Müşteri", phone: "05559990000" } });

  console.log("Demo verisi yüklendi.");
  console.log("Hesaplar (parola SEED_PASSWORD veya README'deki varsayılan):");
  console.log("  demo@proguzellik.local (işletme sahibi), resepsiyon@proguzellik.local, elif@proguzellik.local (personel)");
  console.log("  owner@proguzellik.local (SaaS yöneticisi), kuafor@proguzellik.local (ikinci işletme)");
  console.log(`  Online randevu: /r/${SLUG}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
