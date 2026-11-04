import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
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

/** İstek gövdesi ayrıştırma hataları (çok büyük / bozuk gövde) 500 yerine 413 / 400 döner. */
@Catch()
export class AppExceptionFilter extends BaseExceptionFilter {
  private readonly prismaFilter = new PrismaExceptionFilter();

  catch(e: unknown, host: ArgumentsHost) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) return this.prismaFilter.catch(e, host);
    const type = (e as { type?: unknown })?.type;
    if (typeof type === "string" && type.startsWith("entity.")) {
      const res = host.switchToHttp().getResponse<Response>();
      const status = type === "entity.too.large" ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;
      return res.status(status).json({ statusCode: status, message: status === 413 ? "Gönderilen dosya veya veri çok büyük" : "İstek gövdesi okunamadı" });
    }
    return super.catch(e, host);
  }
}
