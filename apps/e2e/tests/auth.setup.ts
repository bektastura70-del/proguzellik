import { test as setup } from "@playwright/test";
import { authFile, login, UserKey, USERS } from "./helpers";

for (const key of Object.keys(USERS) as UserKey[]) {
  setup(`oturum: ${key}`, async ({ page }) => {
    await login(page, USERS[key]);
    await page.context().storageState({ path: authFile(key) });
  });
}
