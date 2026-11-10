import { NextRequest, NextResponse } from "next/server";
import { relayMetaWebhook } from "../relay";

/** İşletmeye özel adres (salonun kendi Meta uygulaması): /api/webhooks/meta/:connectionId */
async function relay(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ message: "Bulunamadı" }, { status: 404 });
  return relayMetaWebhook(req, `/webhooks/meta/${id}`);
}

export { relay as GET, relay as POST };
