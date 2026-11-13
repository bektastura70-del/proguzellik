/**
 * www/ klasörünü üretir ve capacitor.config.json'u yazar.
 *  - Varsayılan hedef canlı site: https://proguzellik.com
 *  - Yerel deneme: PG_BASE=http://10.0.2.2:3200 npm run sync (Android emülatörü bilgisayardaki sunucuya 10.0.2.2 ile ulaşır).
 *    Bu durumda düz HTTP'ye izin verilir; MAĞAZA DERLEMESİ HER ZAMAN PG_BASE OLMADAN yapılır.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.PG_BASE || "https://proguzellik.com").replace(/\/+$/, "");
const url = new URL(base);
const dev = url.protocol !== "https:";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const www = join(root, "www");
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(join(root, "src"), www, { recursive: true });
cpSync(join(root, "node_modules/jsqr/dist/jsQR.js"), join(www, "jsQR.js"));
writeFileSync(join(www, "config.js"), `window.PG_CONFIG = ${JSON.stringify({ base, version: pkg.version })};\n`);

const hosts = dev ? [url.host] : [url.host, "www." + url.host.replace(/^www\./, "")];
const config = {
  appId: "com.proguzellik.app",
  appName: "Pro Güzellik",
  webDir: "www",
  // Site, uygulamanın içinden açıldığını bu ekle anlar (ana ekrana ekleme ve tarayıcı bildirimi önerilerini gizler).
  appendUserAgent: `ProGuzellikApp/${pkg.version}`,
  backgroundColor: "#faf8f5",
  server: {
    androidScheme: "https",
    allowNavigation: hosts,
    errorPath: "offline.html",
    ...(dev ? { cleartext: true } : {}),
  },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: dev },
  ios: { contentInset: "never", limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: "#faf8f5", showSpinner: false },
    LocalNotifications: { iconColor: "#933c63" },
  },
};
writeFileSync(join(root, "capacitor.config.json"), JSON.stringify(config, null, 2) + "\n");
console.log(`www hazır → ${base}${dev ? " (YEREL DENEME, mağazaya gönderilmez)" : ""}`);
