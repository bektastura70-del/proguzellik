import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { RateLimitService } from "../auth/rate-limit.service";
import { Public } from "../common/decorators";
import { dateOnly, phoneSchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { PublicBookingService } from "./public-booking.service";

const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const slotsSchema = z.object({ date: dateOnly, serviceId: z.string().uuid(), staffId: z.string().uuid().optional() });
const bookingSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  startsAt: z.string().datetime({ offset: true }),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  email: z.string().email().max(200).optional(),
  notes: z.string().max(500).optional(),
  kvkkConsent: z.literal(true, { errorMap: () => ({ message: "KVKK aydınlatma metni onaylanmalı" }) }),
  marketingConsent: z.boolean().optional(),
});
const cancelSchema = z.object({ token: z.string().min(10).max(100) });

/** Kimlik doğrulama gerektirmeyen, işletmeye özel online rezervasyon uç noktaları. */
@Public()
@Controller("public/salons/:slug")
export class PublicBookingController {
  constructor(
    private readonly booking: PublicBookingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  salon(@Param("slug", new ZodPipe(slug)) s: string, @Req() req: Request) {
    this.rateLimit.hit(`public:${req.ip}`, 300, 60_000);
    return this.booking.salon(s);
  }

  @Get("availability")
  slots(@Param("slug", new ZodPipe(slug)) s: string, @Query(new ZodPipe(slotsSchema)) q: z.infer<typeof slotsSchema>, @Req() req: Request) {
    this.rateLimit.hit(`public:${req.ip}`, 300, 60_000);
    return this.booking.slots(s, q);
  }

  @Post("bookings")
  book(@Param("slug", new ZodPipe(slug)) s: string, @Body(new ZodPipe(bookingSchema)) b: z.infer<typeof bookingSchema>, @Req() req: Request) {
    this.rateLimit.hit(`booking-ip:${req.ip}`, 10, 60 * 60_000);
    this.rateLimit.hit(`booking-phone:${s}:${b.phone}`, 3, 24 * 60 * 60_000);
    return this.booking.book(s, b, req.ip);
  }

  @Post("bookings/:id/cancel")
  @HttpCode(200)
  cancel(
    @Param("slug", new ZodPipe(slug)) s: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(cancelSchema)) b: z.infer<typeof cancelSchema>,
    @Req() req: Request,
  ) {
    this.rateLimit.hit(`cancel:${req.ip}`, 20, 60 * 60_000);
    return this.booking.cancel(s, id, b.token);
  }
}
