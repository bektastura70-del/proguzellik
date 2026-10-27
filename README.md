# proguzellik

Güzellik salonları için çok kiracılı (multi-tenant) yönetim platformu.

## Yapı

```
apps/
  web/        Next.js web uygulaması + PWA
  api/        NestJS API
packages/
  shared/     Paylaşılan tipler ve yardımcılar
  ui/         Paylaşılan UI bileşenleri (shadcn/ui)
  config/     Paylaşılan ESLint / Prettier / tsconfig ayarları
docs/         Mimari ve dokümantasyon
infra/        Altyapı dosyaları (ileride)
```

## Teknoloji

Next.js · NestJS · TypeScript · PostgreSQL (RLS) · Redis + BullMQ · Tailwind CSS · shadcn/ui

Ayrıntılar: [docs/architecture.md](docs/architecture.md)

## Durum

Yalnızca iskelet. Paketler henüz kurulmadı (`pnpm install` çalıştırılmadı).
