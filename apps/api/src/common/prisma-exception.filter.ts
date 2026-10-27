import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";

/** Veritabanı kısıt hatalarını 500 yerine anlamlı HTTP yanıtlarına çevirir (iç ayrıntı sızdırmadan). */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Prisma");

  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, [number, string]> = {
      P2002: [HttpStatus.CONFLICT, "Bu kayıt zaten mevcut"],
      P2025: [HttpStatus.NOT_FOUND, "Kayıt bulunamadı"],
      P2003: [HttpStatus.BAD_REQUEST, "İlişkili kayıt bulunamadı veya kullanımda"],
    };
    const hit = map[e.code];
    if (!hit) {
      this.logger.error(`${e.code}: ${e.message}`);
      return res.status(500).json({ statusCode: 500, message: "Beklenmeyen bir hata oluştu" });
    }
    return res.status(hit[0]).json({ statusCode: hit[0], message: hit[1] });
  }
}
