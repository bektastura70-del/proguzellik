import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, RequiresFeature, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { ReportsService } from "./reports.service";

const range = z
  .object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) })
  .refine((v) => new Date(v.from) < new Date(v.to), "Geçersiz tarih aralığı")
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 400 * 86_400_000, "En fazla 400 gün");

@RequiresFeature("REPORTS")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("dashboard")
  @Roles("OWNER", "MANAGER")
  dashboard(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(range)) q: z.infer<typeof range>) {
    return this.reports.dashboard(t, q);
  }

  @Get("daily-revenue")
  @Roles("OWNER", "MANAGER")
  daily(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(range)) q: z.infer<typeof range>) {
    return this.reports.dailyRevenue(t, q);
  }
}
