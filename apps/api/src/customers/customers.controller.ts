import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { dateOnly, paginationSchema, phoneSchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { CustomersService } from "./customers.service";

const base = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: phoneSchema.optional(),
  email: z.string().email().max(200).optional(),
  birthDate: dateOnly.optional(),
  gender: z.enum(["KADIN", "ERKEK", "DIGER"]).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  source: z.string().max(50).optional(),
  kvkkConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  /** true: müşteri yenilenme hatırlatmalarını istemiyor (vazgeçme) */
  renewalRemindersOptOut: z.boolean().optional(),
});
const listSchema = paginationSchema.extend({
  search: z.string().max(100).optional(),
  tag: z.string().max(30).optional(),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

const ALL = ["OWNER", "MANAGER", "RECEPTION", "STAFF"] as const;
const WRITE = ["OWNER", "MANAGER", "RECEPTION"] as const;

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Roles(...ALL)
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.customers.list(t, q);
  }

  @Post()
  @Roles(...WRITE)
  create(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(base)) body: z.infer<typeof base>) {
    return this.customers.create(t, body);
  }

  @Get(":id")
  @Roles(...ALL)
  get(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.get(t, id);
  }

  @Patch(":id")
  @Roles(...WRITE)
  update(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(base.partial())) body: Partial<z.infer<typeof base>>,
  ) {
    return this.customers.update(t, id, body);
  }

  @Get(":id/history")
  @Roles(...ALL)
  history(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.history(t, id);
  }

  @Post(":id/notes")
  @Roles(...ALL)
  addNote(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>,
  ) {
    return this.customers.addNote(t, id, body.body);
  }

  @Get(":id/kvkk-export")
  @Roles("OWNER", "MANAGER")
  export(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.exportData(t, id);
  }

  @Post(":id/anonymize")
  @Roles("OWNER", "MANAGER")
  anonymize(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.anonymize(t, id);
  }
}
