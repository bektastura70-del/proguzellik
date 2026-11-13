import { test } from "node:test";
import assert from "node:assert/strict";
import { deepLinkToPath, isAllowedPath, parseSalonInput, rememberSalon } from "../src/links.js";

const BASE = "https://proguzellik.com";

test("salon kodu: düz kod, tam bağlantı, www, alt sayfa", () => {
  assert.equal(parseSalonInput("deneme", BASE), "deneme");
  assert.equal(parseSalonInput("  Deneme ", BASE), "deneme");
  assert.equal(parseSalonInput("https://proguzellik.com/r/deneme", BASE), "deneme");
  assert.equal(parseSalonInput("proguzellik.com/r/deneme/uygulama", BASE), "deneme");
  assert.equal(parseSalonInput("https://www.proguzellik.com/r/guzel-salon?x=1", BASE), "guzel-salon");
  assert.equal(parseSalonInput("proguzellik://r/deneme", BASE), "deneme");
});

test("salon kodu: yabancı alan adı ve bozuk girdi reddedilir", () => {
  assert.equal(parseSalonInput("https://evil.com/r/deneme", BASE), null);
  assert.equal(parseSalonInput("https://proguzellik.com.evil.com/r/deneme", BASE), null);
  assert.equal(parseSalonInput("javascript:alert(1)", BASE), null);
  assert.equal(parseSalonInput("https://proguzellik.com/panel", BASE), null);
  assert.equal(parseSalonInput("", BASE), null);
  assert.equal(parseSalonInput("-kotu-", BASE), null);
  assert.equal(parseSalonInput("a/b", BASE), null);
});

test("izinli yollar", () => {
  assert.ok(isAllowedPath("/r/deneme"));
  assert.ok(isAllowedPath("/r/deneme/iptal?t=abc"));
  assert.ok(isAllowedPath("/giris"));
  assert.ok(isAllowedPath("/panel/takvim"));
  assert.ok(isAllowedPath("/parola-sifirla?token=x"));
  assert.ok(!isAllowedPath("/satin-al"));
  assert.ok(!isAllowedPath("/fiyatlar"));
  assert.ok(!isAllowedPath("//evil.com/r/x"));
  assert.ok(!isAllowedPath("/r/../satin-al"));
  assert.ok(!isAllowedPath("https://evil.com"));
});

test("derin bağlantılar", () => {
  assert.equal(deepLinkToPath("proguzellik://r/deneme", BASE), "/r/deneme");
  assert.equal(deepLinkToPath("https://proguzellik.com/r/deneme/iptal?t=1", BASE), "/r/deneme/iptal?t=1");
  assert.equal(deepLinkToPath("https://www.proguzellik.com/giris", BASE), "/giris");
  assert.equal(deepLinkToPath("http://proguzellik.com/r/deneme", BASE), null);
  assert.equal(deepLinkToPath("https://evil.com/r/deneme", BASE), null);
  assert.equal(deepLinkToPath("https://proguzellik.com/satin-al", BASE), null);
  assert.equal(deepLinkToPath("not a url", BASE), null);
});

test("son salonlar", () => {
  let l = rememberSalon([], "a", "A", 1);
  l = rememberSalon(l, "b", null, 2);
  l = rememberSalon(l, "a", null, 3);
  assert.deepEqual(l.map((s) => s.slug), ["a", "b"]);
  assert.equal(l[0].name, "A");
  for (let i = 0; i < 10; i++) l = rememberSalon(l, "s" + i, null, 10 + i);
  assert.equal(l.length, 6);
});
