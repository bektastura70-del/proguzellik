#!/usr/bin/env node
/**
 * Uygulama sürümünü tek yerden ayarlar (Android + iOS + uygulama kimliği).
 *   node scripts/set-version.mjs 1.0.1          → sürüm adı 1.0.1, yapı numarası 10001
 *   node scripts/set-version.mjs 1.0.1 --build 10002   → aynı sürümün ikinci yüklemesi
 * Kural: sürüm adı MAJOR.MINOR.PATCH; yapı numarası her mağaza yüklemesinde artmalı (aynı numara ikinci kez yüklenemez).
 * Varsayılan yapı numarası = MAJOR*10000 + MINOR*100 + PATCH (1.2.3 → 10203), sonraki yükleme için +1 verilir.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function buildNumber(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error("Sürüm MAJOR.MINOR.PATCH biçiminde olmalı (ör. 1.0.1)");
  const [maj, min, pat] = m.slice(1).map(Number);
  if (min > 99 || pat > 99) throw new Error("MINOR ve PATCH en fazla 99 olabilir");
  return maj * 10000 + min * 100 + pat;
}

export function applyVersion(files, version, build) {
  const out = { ...files };
  out.gradle = files.gradle
    .replace(/versionCode \d+/, `versionCode ${build}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
  out.pbxproj = files.pbxproj
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`)
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  const pkg = JSON.parse(files.pkg);
  pkg.version = version;
  out.pkg = JSON.stringify(pkg, null, 2) + "\n";
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, flag, b] = process.argv.slice(2);
  if (!version) {
    console.error("Kullanım: node scripts/set-version.mjs <MAJOR.MINOR.PATCH> [--build <sayı>]");
    process.exit(1);
  }
  const build = flag === "--build" ? Number(b) : buildNumber(version);
  if (!Number.isInteger(build) || build < 1 || build > 2_100_000_000) throw new Error("Geçersiz yapı numarası");
  const paths = {
    gradle: resolve(root, "android/app/build.gradle"),
    pbxproj: resolve(root, "ios/App/App.xcodeproj/project.pbxproj"),
    pkg: resolve(root, "package.json"),
  };
  const files = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p, "utf8")]));
  const next = applyVersion(files, version, build);
  for (const k of Object.keys(paths)) writeFileSync(paths[k], next[k]);
  console.log(`Sürüm ${version} (yapı ${build}) yazıldı. Sonra: npm run sync`);
}
