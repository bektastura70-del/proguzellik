import { RateLimitService } from "../src/auth/rate-limit.service";

describe("RateLimitService belleği", () => {
  const prev = process.env.DISABLE_RATE_LIMIT;
  beforeAll(() => delete process.env.DISABLE_RATE_LIMIT);
  afterAll(() => {
    if (prev !== undefined) process.env.DISABLE_RATE_LIMIT = prev;
  });

  it("sınırı uygular", () => {
    const r = new RateLimitService();
    r.hit("k", 2, 60_000);
    r.hit("k", 2, 60_000);
    expect(() => r.hit("k", 2, 60_000)).toThrow();
  });

  it("rastgele anahtarlarla kova sayısı sınırsız büyümez", () => {
    const r = new RateLimitService();
    for (let i = 0; i < 120_000; i++) r.hit(`rastgele-${i}`, 3, 60_000);
    expect(r.size).toBeLessThanOrEqual(50_000);
  });
});
