import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVersion, buildNumber } from "../scripts/set-version.mjs";

test("yapı numarası sürümden türetilir ve artar", () => {
  assert.equal(buildNumber("1.0.0"), 10000);
  assert.equal(buildNumber("1.2.3"), 10203);
  assert.ok(buildNumber("1.0.1") > buildNumber("1.0.0"));
  assert.ok(buildNumber("2.0.0") > buildNumber("1.99.99"));
  assert.throws(() => buildNumber("1.0"));
  assert.throws(() => buildNumber("1.100.0"));
});

test("Android, iOS ve paket sürümü birlikte yazılır", () => {
  const files = {
    gradle: 'versionCode 1\n        versionName "1.0"',
    pbxproj: "CURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0;\nCURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0;",
    pkg: '{"name":"x","version":"1.0.0"}',
  };
  const out = applyVersion(files, "1.0.1", 10001);
  assert.match(out.gradle, /versionCode 10001/);
  assert.match(out.gradle, /versionName "1\.0\.1"/);
  assert.equal(out.pbxproj.match(/CURRENT_PROJECT_VERSION = 10001;/g).length, 2);
  assert.equal(out.pbxproj.match(/MARKETING_VERSION = 1\.0\.1;/g).length, 2);
  assert.equal(JSON.parse(out.pkg).version, "1.0.1");
});
