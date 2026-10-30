# Mimari

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript
- **API (`apps/api`):** NestJS 11, Prisma 6, Zod doğrulama, JWT (HS256)
- **Web (`apps/web`):** Next.js 15 App Router, Tailwind 4, shadcn tarzı yerel bileşenler, PWA (manifest + service worker)
- **Veritabanı:** PostgreSQL 16, kiracı bazlı Row Level Security
- **Kuyruk:** Redis 7 + BullMQ (bildirim gönderimi, zamanlanmış hatırlatmalar)

## İstek akışı

Tarayıcı → Next.js `/api/p/*` vekili (httpOnly çerezdeki token'ı `Authorization` başlığına ekler, seçili işletmeyi `X-Tenant-Id` olarak iletir) → NestJS.

NestJS'te tek global `AuthGuard`:
1. JWT doğrular, kullanıcının aktif olduğunu kontrol eder.
2. `@Roles(...)` olan uç noktalarda `X-Tenant-Id` + aktif üyelik + rol + işletme durumu (deneme bitti/askıda/ödeme bekliyor) + paket özelliği (`@RequiresFeature`) kontrol edilir.

## Veritabanı rolleri ve RLS

| Rol | Kullanım | RLS |
| --- | --- | --- |
| `proguzellik` | Yalnızca migration | (süper kullanıcı) |
| `app_tenant` | İşletme istekleri | Zorunlu (`FORCE ROW LEVEL SECURITY`) |
| `app_platform` | Giriş, SaaS sahibi paneli, bildirim işçisi | `BYPASSRLS` |

- Her işletme işlemi `PrismaService.withTenant()` ile tek transaction'da çalışır ve `set_config('app.tenant_id', …, true)` (SET LOCAL) kullanır. Ayar yoksa `app_current_tenant()` NULL döner ve hiçbir satır görünmez.
- `tenantId` taşıyan her tablo `app_secure_tenant_table()` ile korunur; bir test, RLS'siz tablo kalmadığını otomatik doğrular.
- İşletmeler arası bağlar bileşik yabancı anahtarlarla (`(tenantId, id)`) veritabanı düzeyinde engellenir.
- Değiştirilemez kayıtlar: `AuditLog`, `FinanceTransaction`, `StockMovement` (UPDATE/DELETE yetkisi yok).
- `Tenant` tablosunda işletme yalnızca profil sütunlarını güncelleyebilir (durum/paket/deneme süresi sütun yetkisiyle kapalı).
- Aynı personelde çakışan randevu `EXCLUDE USING gist` kısıtıyla engellenir.

## Paketler

| Paket | Personel | Özellikler |
| --- | --- | --- |
| Başlangıç | 3 | CRM, randevu, online rezervasyon, kasa, paketler |
| Profesyonel | 8 | + stok, raporlar, WhatsApp |
| Akıllı | 20 | + yapay zekâ asistanı |

### Fiyat yönetimi (`/platform` → Paketler ve fiyatlar)

- Paket bilgisi (ad, açıklama, personel / müşteri / aylık randevu sınırı, özellikler, **aktif/pasif**, **satışta/gizli**) ile fiyat ayrıdır.
  Pasif paket hiçbir işletmeye yeni atanamaz; gizli paket sitede ve kayıtta görünmez, yalnız SaaS sahibi atayabilir.
- Fiyat her zaman yeni bir **sürümdür** (`PlanPrice`): aylık ve yıllık tutar **KDV hariç**, sürümün kendi KDV oranı, yeni satışta geçerlilik tarihi ve mevcut aboneliklere etkisi.
  Taslak hiçbir yerde kullanılmaz; SaaS sahibi **parola + 2FA** ile onaylar. Onaylı sürüm değiştirilemez ve silinemez (veritabanı tetikleyicisi); yalnız yürürlüğe girmeden ve aboneliğe bağlanmadan iptal edilebilir.
- Geriye dönük uygulama yoktur: geçmiş tarihli taslak, onay anından itibaren geçerli olur. Aynı anda yürürlükteki sürümler arasında en son onaylanan geçerlidir.
- **Fiyat kilidi:** abonelik başlarken o anki onaylı sürüme kilitlenir (`Subscription.planPriceId`, `priceAmount`, `vatRate`). Yeni sürüm mevcut aboneliği değiştirmez;
  yalnız "yenilemede uygula" seçilen sürüm, belirtilen tarihte ya da sonrasında **başlayan** ilk yenileme döneminden itibaren uygulanır. Devam eden dönem hiçbir zaman değişmez.
- Tahsilat KDV dahil tutardır; ödeme kaydında KDV hariç tutar ve oran ayrıca saklanır. MRR kilitli fiyatlardan hesaplanır.
- Tanıtım sitesi ve işletme paneli tutarı yalnız onaylı, yürürlükteki sürümden alır; onaylı fiyatı olmayan pakette "Fiyat yakında" yazar ve satın alma yapılamaz.
  Eski `Plan.monthlyPrice/yearlyPrice` sütunları geriye dönük uyum için durur, hiçbir yanıtta dönmez. `PRICING_PUBLIC=0` acil durumda tüm tutarları gizler.
