import { test } from "@playwright/test";
import { authFile } from "./helpers";
test.use({ storageState: authFile("owner") });
const OUT = process.env.SHOTS_DIR!;
for (const p of ["/panel", "/panel/takvim", "/panel/takvim?gorunum=hafta", "/panel/takvim?gorunum=ay", "/panel/musteriler", "/panel/kasa", "/panel/personel", "/panel/raporlar"]) {
  test(`shot ${p}`, async ({ page }, info) => {
    test.skip(!OUT);
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${info.project.name}${p.replace(/[/?=]/g, "_")}.png`, fullPage: true });
  });
}
