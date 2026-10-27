import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { E2E_PSQL } from "../env";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/\s|=/g, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (testte kimlik doğrulama uygulamasının yerine). */
export function totp(secret: string, offsetSteps = 0) {
  const step = Math.floor(Date.now() / 30_000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Sunucu aynı 30 sn'lik kodu ikinci kez kabul etmez; testte zamanın ilerlemesi simüle edilir. */
export function resetTotpReplay(email: string) {
  sql(`UPDATE "User" SET "mfaLastStep" = NULL WHERE email = '${email.replace(/'/g, "''")}'`);
}

export function sql(q: string) {
  return execSync(E2E_PSQL, { input: q, encoding: "utf8" }).trim();
}

/** Test e-posta kutusundan (mock sağlayıcının kaydı) son e-postanın gövdesi. */
export function lastEmail(to: string, subject: string) {
  return sql(`SELECT body FROM "OutboundEmail" WHERE "to" = '${to}' AND subject = '${subject}' ORDER BY "createdAt" DESC LIMIT 1`);
}
