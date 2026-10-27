import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/** Basit bellek içi hız sınırlayıcı (tek süreç). Çok sunuculu kurulumda Redis'e taşınmalı. */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, limit: number, windowMs: number) {
    if (process.env.DISABLE_RATE_LIMIT === "1") return;
    const now = Date.now();
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
