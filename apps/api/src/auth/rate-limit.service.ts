import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/** Kova sayısı bu sınırı aşınca süresi dolanlar temizlenir; yine de aşılırsa en eskiler atılır (bellek sınırlı kalır). */
const MAX_BUCKETS = 50_000;

/** Basit bellek içi hız sınırlayıcı (tek süreç). Çok sunuculu kurulumda Redis'e taşınmalı. */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  get size() {
    return this.buckets.size;
  }

  private evict(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt < now) this.buckets.delete(k);
    // Map ekleme sırasını korur: hâlâ fazlaysa en eski kovalar atılır.
    for (const k of this.buckets.keys()) {
      if (this.buckets.size <= MAX_BUCKETS * 0.9) break;
      this.buckets.delete(k);
    }
  }

  hit(key: string, limit: number, windowMs: number) {
    if (process.env.DISABLE_RATE_LIMIT === "1") return;
    const now = Date.now();
    if (this.buckets.size >= MAX_BUCKETS) this.evict(now);
    const b = this.buckets.get(key);
    if (!b || b.resetAt < now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    b.count += 1;
    if (b.count > limit) {
      throw new HttpException("Çok fazla istek. Lütfen biraz bekleyin.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
