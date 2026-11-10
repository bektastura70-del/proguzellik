import { NextRequest } from "next/server";
import { relayMetaWebhook } from "./relay";

/** Ortak adres (ProGüzellik Meta uygulaması, Embedded Signup ile bağlanan numaralar): /api/webhooks/meta */
async function relay(req: NextRequest) {
  return relayMetaWebhook(req, "/webhooks/meta");
}

export { relay as GET, relay as POST };
