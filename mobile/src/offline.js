import { isAllowedPath } from "./links.js";

const BASE = (window.PG_CONFIG && window.PG_CONFIG.base) || "https://proguzellik.com";

document.getElementById("retry").addEventListener("click", () => {
  const target = new URLSearchParams(location.search).get("hedef");
  if (!navigator.onLine) return;
  location.href = target && isAllowedPath(target) ? BASE + target : "index.html";
});
window.addEventListener("online", () => document.getElementById("retry").click());
