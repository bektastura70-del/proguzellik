import { Tx } from "../prisma/prisma.service";
import { WhatsAppProvider } from "./whatsapp.provider";

/**
 * Bu işletme için WhatsApp şablon mesajı gerçekten gönderilebilir mi?
 * İşletmenin doğrulanmış (CONNECTED) kendi numarası varsa evet; yoksa platform sağlayıcısına bakılır.
 * Canlıda platform sağlayıcısı kapalıdır ("disabled"): bağlantısı olmayan işletmeye WhatsApp kaydı hiç açılmaz,
 * böylece "WhatsApp bağlı değil" diye atlanan kayıtlar ve hata satırları oluşmaz. WhatsApp kullanmayan salon
 * için sistem sessizce e-posta ve panel bildirimleriyle çalışır.
 */
export async function whatsappDeliverable(tx: Tx, tenantId: string, provider: WhatsAppProvider) {
  const conn = await tx.channelConnection.findUnique({ where: { tenantId_channel: { tenantId, channel: "WHATSAPP" } }, select: { status: true } });
  if (conn?.status === "CONNECTED") return true;
  return provider.name !== "disabled";
}
