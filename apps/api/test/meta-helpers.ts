import { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import request from "supertest";

/** Meta belgelerindeki örnek gövde biçiminde WhatsApp metin mesajı (değerler test için). */
export function waText(phoneNumberId: string, from: string, id: string, body: string, name = "Ayşe Test") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "102290129340398", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550783881", phone_number_id: phoneNumberId }, contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }],
  };
}
export function igText(igId: string, sender: string, mid: string, text: string, echo = false) {
  return { object: "instagram", entry: [{ id: igId, time: Date.now(), messaging: [{ sender: { id: echo ? igId : sender }, recipient: { id: echo ? sender : igId }, timestamp: Date.now(), message: { mid, text, ...(echo ? { is_echo: true } : {}) } }] }] };
}
export function signedPost(app: INestApplication, connId: string, body: unknown, secret: string) {
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return request(app.getHttpServer()).post(`/webhooks/meta/${connId}`).set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw);
}

