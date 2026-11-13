/** Mağaza simgesi ve açılış ekranı kaynak görsellerini marka simgesinden (src/logo.svg ile aynı tasarım) üretir. */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const BRAND = "#933c63", LIGHT = "#f6e7ee", BG = "#faf8f5";
const mark = (scale = 1, color = LIGHT) => `<g transform="translate(${512 * (1 - scale)} ${512 * (1 - scale)}) scale(${scale})">
  <path d="M320 704c0-192 96-352 192-352s192 160 192 352" fill="none" stroke="${color}" stroke-width="68" stroke-linecap="round"/>
  <circle cx="512" cy="280" r="76" fill="${color}"/></g>`;
const svg = (body, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ?? ""}${body}</svg>`);
mkdirSync("assets", { recursive: true });
// iOS ve mağaza simgesi: tam kare, saydamlık yok (Apple şartı).
await sharp(svg(mark(1), `<rect width="1024" height="1024" fill="${BRAND}"/>`)).flatten({ background: BRAND }).png().toFile("assets/icon-only.png");
// Android uyarlanabilir simge: ön plan güvenli alanda (%66), arka plan düz renk.
await sharp(svg(mark(0.62))).png().toFile("assets/icon-foreground.png");
await sharp(svg("", `<rect width="1024" height="1024" fill="${BRAND}"/>`)).png().toFile("assets/icon-background.png");
// Açılış ekranı: açık zemin üzerinde marka simgesi.
const splash = (bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${bg}"/>
  <g transform="translate(1110 1110) scale(0.5)"><rect width="1024" height="1024" rx="224" fill="${BRAND}"/>${mark(1)}</g></svg>`);
await sharp(splash(BG)).png().toFile("assets/splash.png");
await sharp(splash("#231a1f")).png().toFile("assets/splash-dark.png");
console.log("assets/ hazır");
