import { cleanSalonMeta, deepLinkToPath, forgetSalon, isAllowedPath, parseSalonInput, rememberSalon, updateSalonMeta } from "./links.js";

/**
 * Uygulamanın yerel giriş ekranı. Ağ gerektirmez; salon ya da panel seçildikten sonra
 * Pro Güzellik sitesindeki ilgili sayfa uygulamanın içinde açılır (oturum çerezleri cihazda kalır).
 * Son salonlar ve son açılan yer yalnızca bu cihazda tutulur, sunucuya gönderilmez.
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

function openSalon(slug, meta = {}) {
  write(KEY_RECENT, rememberSalon(read(KEY_RECENT, []), slug, meta.name || null, Date.now(), meta.logo || null));
  write(KEY_LAST, "/r/" + slug);
  go("/r/" + slug);
}

function renderRecent() {
  const list = read(KEY_RECENT, []).filter((s) => s && typeof s.slug === "string");
  const ul = $("recent");
  ul.textContent = "";
  ul.hidden = list.length === 0;
  $("recent-title").hidden = list.length === 0;
  list.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "recent-row";

    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn recent-item";
    const icon = document.createElement("span");
    icon.className = "recent-logo";
    icon.setAttribute("aria-hidden", "true");
    const label = s.name || s.slug;
    if (s.logo) {
      const img = document.createElement("img");
      img.src = BASE + s.logo;
      img.alt = "";
      img.addEventListener("error", () => {
        img.remove();
        icon.textContent = label.slice(0, 1).toUpperCase();
      });
      icon.appendChild(img);
    } else {
      icon.textContent = label.slice(0, 1).toUpperCase();
    }
    const text = document.createElement("span");
    text.className = "recent-text";
    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = label;
    text.appendChild(name);
    if (i === 0) {
      const tag = document.createElement("span");
      tag.className = "recent-tag";
      tag.textContent = "Son salonum";
      text.appendChild(tag);
    }
    b.append(icon, text);
    b.addEventListener("click", () => openSalon(s.slug));

    const x = document.createElement("button");
    x.type = "button";
    x.className = "recent-remove";
    x.setAttribute("aria-label", `${label} salonunu listeden kaldır`);
    x.textContent = "×";
    x.addEventListener("click", () => {
      const next = forgetSalon(read(KEY_RECENT, []), s.slug);
      write(KEY_RECENT, next);
      if (read(KEY_LAST, null) === "/r/" + s.slug) write(KEY_LAST, null);
      renderRecent();
      (next.length ? $("recent").querySelector(".recent-item") : $("scan"))?.focus();
    });

    li.append(b, x);
    ul.appendChild(li);
  });
}

function showError(msg) {
  const el = $("slug-error");
  el.textContent = msg;
  el.hidden = !msg;
}

/* ---- QR tarama (kamera görüntüsü cihazda işlenir, hiçbir yere gönderilmez) ---- */
let stream = null;
let raf = 0;
let lastRejected = "";
function scanHint(msg) {
  $("scan-hint").textContent = msg || "Salonun QR kodunu çerçeveye getirin";
}
async function startScan() {
  showError("");
  if (!navigator.mediaDevices?.getUserMedia || typeof window.jsQR !== "function") {
    showError("Bu cihazda QR tarama kullanılamıyor. Salon bağlantısını yazarak açabilirsiniz.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (e) {
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    showError(
      denied
        ? "Kamera izni verilmedi. Telefonunuzun Ayarlar > Pro Güzellik bölümünden kamera iznini açabilir ya da salon bağlantısını yazabilirsiniz."
        : "Kamera açılamadı. Salon bağlantısını ya da kodunu yazarak açabilirsiniz.",
    );
    return;
  }
  lastRejected = "";
  scanHint("");
  const video = $("video");
  video.srcObject = stream;
  $("scanner").hidden = false;
  $("app").setAttribute("aria-hidden", "true");
  $("scan-close").focus();
  await video.play().catch(() => undefined);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let frame = 0;
  const tick = () => {
    if (!stream) return;
    frame++;
    if (video.readyState >= 2 && video.videoWidth) {
      const w = Math.min(640, video.videoWidth);
      const h = Math.round((video.videoHeight / video.videoWidth) * w);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      // Koyu zemin üzerine açık renkli (ters) QR afişleri için her 4 karede bir ters deneme yapılır.
      const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: frame % 4 === 0 ? "attemptBoth" : "dontInvert" });
      if (code && code.data) {
        const slug = parseSalonInput(code.data, BASE);
        if (slug) {
          stopScan();
          openSalon(slug);
          return;
        }
        if (code.data !== lastRejected) {
          lastRejected = code.data;
          scanHint("Bu QR kodu bir Pro Güzellik salonuna ait değil. Salonun randevu QR kodunu okutun.");
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
  $("video").srcObject = null;
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

  // Salon sayfasından "Salon değiştir" ile dönülürken site salonun adını/logosunu verir (yalnızca listede gösterim için).
  const metaSlug = params.get("salon");
  if (metaSlug && /^[a-z0-9-]{1,60}$/.test(metaSlug)) {
    const meta = cleanSalonMeta(metaSlug, params.get("ad"), params.get("logo"));
    write(KEY_RECENT, updateSalonMeta(read(KEY_RECENT, []), metaSlug, meta.name, meta.logo));
  }

  // Derin bağlantı (yerel kod ?open= ile verir; salon rehberi de bu yolla salon açar) önce gelir.
  if (open && !home) {
    const path = isAllowedPath(open) ? open : deepLinkToPath(open, BASE);
    if (path) {
      const m = /^\/r\/([a-z0-9-]+)/.exec(path);
      if (m) {
        const meta = cleanSalonMeta(m[1], params.get("ad"), params.get("logo"));
        write(KEY_RECENT, rememberSalon(read(KEY_RECENT, []), m[1], meta.name, Date.now(), meta.logo));
        write(KEY_LAST, "/r/" + m[1]);
      }
      go(path);
      return;
    }
  }
  // Uygulama açılışında son salona doğrudan gidilir; "Ana ekran" ile dönüldüyse seçim ekranı gösterilir.
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
  // Uygulama arka plana geçince kamera hemen kapatılır.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && stream) stopScan();
  });
  $("directory").addEventListener("click", () => go("/salonlar"));
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
