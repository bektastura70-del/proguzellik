import { deepLinkToPath, isAllowedPath, parseSalonInput, rememberSalon } from "./links.js";

/**
 * Uygulamanın yerel giriş ekranı. Ağ gerektirmez; salon ya da panel seçildikten sonra
 * Pro Güzellik sitesindeki ilgili sayfa uygulamanın içinde açılır (oturum çerezleri cihazda kalır).
 */
const BASE = (window.PG_CONFIG && window.PG_CONFIG.base) || "https://proguzellik.com";
const Cap = window.Capacitor;
const KEY_RECENT = "pg.recent";
const KEY_LAST = "pg.last";

const $ = (id) => document.getElementById(id);

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* özel modda depolama olmayabilir; uygulama yine çalışır */
  }
}

function go(path) {
  if (!isAllowedPath(path)) return;
  if (!navigator.onLine) {
    location.href = "offline.html?hedef=" + encodeURIComponent(path);
    return;
  }
  location.href = BASE + path;
}

function openSalon(slug) {
  write(KEY_RECENT, rememberSalon(read(KEY_RECENT, []), slug, null));
  write(KEY_LAST, "/r/" + slug);
  go("/r/" + slug);
}

function renderRecent() {
  const list = read(KEY_RECENT, []);
  const ul = $("recent");
  ul.textContent = "";
  ul.hidden = list.length === 0;
  for (const s of list) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn recent-item";
    b.textContent = s.name || s.slug;
    b.addEventListener("click", () => openSalon(s.slug));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function showError(msg) {
  const el = $("slug-error");
  el.textContent = msg;
  el.hidden = !msg;
}

/* ---- QR tarama (kamera görüntüsü cihazda işlenir, hiçbir yere gönderilmez) ---- */
let stream = null;
let raf = 0;
async function startScan() {
  showError("");
  if (!navigator.mediaDevices?.getUserMedia || typeof window.jsQR !== "function") {
    showError("Bu cihazda QR tarama kullanılamıyor. Salon bağlantısını yazarak açabilirsiniz.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    showError("Kamera izni verilmedi. Ayarlardan kamera iznini açabilir ya da salon bağlantısını yazabilirsiniz.");
    return;
  }
  const video = $("video");
  video.srcObject = stream;
  $("scanner").hidden = false;
  $("app").setAttribute("aria-hidden", "true");
  $("scan-close").focus();
  await video.play().catch(() => undefined);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tick = () => {
    if (!stream) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const w = Math.min(640, video.videoWidth);
      const h = Math.round((video.videoHeight / video.videoWidth) * w);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        const slug = parseSalonInput(code.data, BASE);
        if (slug) {
          stopScan();
          openSalon(slug);
          return;
        }
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function stopScan() {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("scanner").hidden = true;
  $("app").removeAttribute("aria-hidden");
  $("scan").focus();
}

/* ---- Yerel hatırlatma izni (bildirimleri web sayfası değil, telefonun kendisi gösterir) ---- */
async function remindersInit() {
  if (!Cap?.isNativePlatform?.()) return;
  const card = $("reminders-card");
  try {
    const p = await Cap.nativePromise("LocalNotifications", "checkPermissions", {});
    if (p.display === "granted") return;
    card.hidden = false;
    if (p.display === "denied") {
      $("reminders-text").textContent = "Hatırlatma izni kapalı. Telefonunuzun Ayarlar > Pro Güzellik > Bildirimler bölümünden açabilirsiniz.";
      $("reminders").hidden = true;
    }
  } catch {
    /* eklenti yoksa kart gizli kalır */
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const open = params.get("open");
  const home = params.has("home") || params.get("open") === "proguzellik://home";

  // Derin bağlantı (yerel kod tarafından ?open= ile verilir) önce gelir.
  if (open && !home) {
    const path = isAllowedPath(open) ? open : deepLinkToPath(open, BASE);
    if (path) {
      const m = /^\/r\/([a-z0-9-]+)/.exec(path);
      if (m) write(KEY_RECENT, rememberSalon(read(KEY_RECENT, []), m[1], null));
      go(path);
      return;
    }
  }
  // Uygulama açılışında son kullanılan yere doğrudan gidilir; "Ana ekran" ile dönüldüyse seçim ekranı gösterilir.
  const last = read(KEY_LAST, null);
  if (!home && typeof last === "string" && isAllowedPath(last) && navigator.onLine) {
    go(last);
    return;
  }

  $("app").hidden = false;
  renderRecent();
  remindersInit();

  $("scan").addEventListener("click", startScan);
  $("scan-close").addEventListener("click", stopScan);
  $("slug-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const slug = parseSalonInput($("slug-input").value, BASE);
    if (!slug) {
      showError("Bu bir Pro Güzellik salon bağlantısı ya da kodu değil. Örnek: proguzellik.com/r/salonadi");
      return;
    }
    showError("");
    openSalon(slug);
  });
  $("panel").addEventListener("click", () => {
    write(KEY_LAST, "/giris");
    go("/giris");
  });
  $("reminders").addEventListener("click", async () => {
    try {
      const p = await Cap.nativePromise("LocalNotifications", "requestPermissions", {});
      if (p.display === "granted") $("reminders-card").hidden = true;
      else remindersInit();
    } catch {
      /* yok sayılır */
    }
  });
  $("privacy").addEventListener("click", (e) => {
    e.preventDefault();
    location.href = BASE + "/gizlilik-politikasi";
  });
  $("delete-info").addEventListener("click", (e) => {
    e.preventDefault();
    location.href = BASE + "/hesap-silme";
  });
}

init();
