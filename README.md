# ProGüzellik

Güzellik salonları için çok kiracılı (multi-tenant) SaaS yönetim platformu: randevu, müşteri CRM, paket/seans, kasa, stok, raporlar, online rezervasyon, WhatsApp bildirimleri ve yapay zekâ asistanı.

> Bu depo yalnızca **yerel geliştirme** için yapılandırılmıştır. Gerçek ödeme, gerçek WhatsApp gönderimi ve canlı yayın kapalıdır.

## Yapı

```
apps/
  api/        NestJS 11 API (Prisma, PostgreSQL RLS, BullMQ)
  web/        Next.js 15 web paneli + PWA (Tailwind 4, shadcn tarzı bileşenler)
packages/     Paylaşılan paketler için ayrılmış alan
docs/         Mimari ve güvenlik notları
infra/        Yerel Docker servisleri (PostgreSQL 16, Redis 7)
```

## Yerelde çalıştırma

Gereksinimler: Node 20+, pnpm 9, Docker.

```bash
pnpm install
pnpm infra:up                      # proguzellik-postgres (127.0.0.1:5435), proguzellik-redis (127.0.0.1:6381)
cp apps/api/.env.example apps/api/.env   # JWT_SECRET'ı doldurun: openssl rand -hex 32
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate                    # migration'lar (RLS politikaları dahil)
pnpm db:dev-roles                  # yalnızca yerel: uygulama DB rollerine parola verir
pnpm db:seed                       # uydurma demo verisi (gerçek kişi verisi yok)
pnpm --filter @proguzellik/api build && pnpm --filter @proguzellik/api start   # API :4000
pnpm --filter @proguzellik/web build && pnpm --filter @proguzellik/web start   # Web :3000
```

Geliştirme modu: `pnpm --filter @proguzellik/api dev` ve `pnpm --filter @proguzellik/web dev`.

### Demo hesapları (yalnızca `pnpm db:seed` sonrası, yerel)

Parola: `SEED_PASSWORD` ortam değişkeni, tanımlı değilse `Demo12345!`.

| Hesap | Rol |
| --- | --- |
| demo@proguzellik.local | Işıltı Güzellik Stüdyosu sahibi (Akıllı paket, deneme) |
| resepsiyon@proguzellik.local | Resepsiyon |
| elif@proguzellik.local | Personel |
| owner@proguzellik.local | SaaS sahibi paneli (`/yonetim`) |
| kuafor@proguzellik.local | İkinci işletme (Başlangıç paketi, izolasyonu görmek için) |

Online randevu sayfası: `http://localhost:3000/r/isilti-guzellik`

## Testler

```bash
pnpm test        # API: 143 test, gerçek PostgreSQL + Redis (ayrı proguzellik_test veritabanı)
pnpm test:e2e    # Tarayıcı: 126 Playwright testi (masaüstü/tablet/mobil), sistem Chrome'u ile
pnpm turbo run typecheck build
```

- API testleri `proguzellik_test`, tarayıcı testleri `proguzellik_e2e` veritabanını kullanır; geliştirme verisine dokunmaz.
- Tarayıcı testleri API'yi 4200, web'i 3200 portunda kendisi başlatır ve her çalıştırmada E2E veritabanına uydurma demo verisini yeniden yükler.
- Rapor: `apps/e2e/playwright-report/index.html`

## Modüller

| Modül | Durum |
| --- | --- |
| Multi-tenant altyapı, PostgreSQL RLS, roller (Sahip/Yönetici/Resepsiyon/Personel) | Tamam |
| Güvenli giriş (bcrypt, hesap kilitleme, hız sınırı, httpOnly çerez) | Tamam |
| SaaS sahibi paneli, işletme yönetimi, 14 gün deneme, paketler (3/8/20 personel) | Tamam (test ödeme sağlayıcısı) |
| Müşteri CRM, notlar, geçmiş, bakiye, KVKK dışa aktarma/anonimleştirme | Tamam |
| Hizmetler, personel, çalışma saatleri, izinler, randevu takvimi | Tamam |
| Online rezervasyon (herkese açık sayfa, imzalı iptal bağlantısı) | Tamam |
| Paket ve seans yönetimi | Tamam |
| Kasa: tahsilat, gelir-gider, kısmi iade, personel primleri | Tamam |
| Stok, sarf malzemesi otomatik düşümü, perakende satış, raporlar | Tamam |
| WhatsApp Cloud API bildirimleri (BullMQ, onay/hatırlatma/iptal, webhook) | Altyapı tamam, varsayılan test modu |
| Yapay zekâ işletme asistanı (Akıllı paket) | Tamam, varsayılan yerel mod; Claude API isteğe bağlı |
| Türkçe, mobil uyumlu panel, PWA, KVKK/gizlilik/çerez sayfaları | Tamam (yasal metinler şablon) |

## Harici servisler (gerçek anahtar yok)

`apps/api/.env` içinde tanımlanır; varsayılanlar güvenli test modlarıdır:

- `WHATSAPP_MODE=mock` → mesaj gönderilmez. Gerçek gönderim için `cloud` + `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` ve Meta'da onaylı şablonlar (`randevu_onay`, `randevu_hatirlatma`, `randevu_iptal`) gerekir.
- `AI_MODE=mock` → kural tabanlı yerel asistan. `anthropic` için `ANTHROPIC_API_KEY` gerekir; yalnızca toplu metrikler gönderilir.
- Ödeme: `MockPaymentProvider` (gerçek tahsilat yok). Üretimde iyzico/PayTR gibi bir sağlayıcı `PaymentProvider` arayüzüyle eklenmeli.

Ayrıntılar: [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/deployment.md](docs/deployment.md) (canlıya hazırlık, yedekleme/geri yükleme)

## İşletim komutları

```bash
pnpm --filter @proguzellik/api env:check     # ortam değişkenlerini denetler (NODE_ENV=production ile canlı kuralları)
pnpm --filter @proguzellik/api job:daily     # günlük abonelik görevini elle çalıştırır (aynı gün ikinci kez atlar)
infra/scripts/backup.sh                       # veritabanı yedeği (backups/)
infra/scripts/verify-backup.sh <dosya>        # yedeği geçici veritabanında doğrular
```

Yerelde SaaS yöneticisi (`owner@proguzellik.local`) ilk girişte iki adımlı doğrulamayı kurmaya yönlendirilir. Test modunda e-postalar gönderilmez; `OutboundEmail` tablosunda ve API günlüğünde görünür.
