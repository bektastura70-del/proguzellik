/* Ortam değişkenlerini doğrular: `pnpm --filter @proguzellik/api env:check` */
import { loadEnv, productionIssues } from "../config/env";

try {
  const env = loadEnv();
  const issues = productionIssues(env);
  const errors = issues.filter((i) => i.level === "error");
  console.log(`NODE_ENV=${env.NODE_ENV}`);
  for (const i of issues) console.log(`${i.level === "error" ? "HATA " : "UYARI"}  ${i.message}`);
  if (!issues.length) console.log("Sorun bulunmadı.");
  console.log(errors.length ? `\n${errors.length} hata: canlı ortama uygun değil.` : "\nCanlı ortam için engelleyici hata yok.");
  process.exit(errors.length && env.NODE_ENV === "production" ? 1 : 0);
} catch (e) {
  console.error(`HATA  ${(e as Error).message}`);
  process.exit(1);
}
