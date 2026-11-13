/** Google Play öne çıkan grafik (1024x500) ve mağaza simgeleri. */
import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500"><rect width="1024" height="500" fill="#933c63"/>
<g transform="translate(90 130) scale(0.47)"><rect width="512" height="512" rx="112" fill="#f6e7ee"/><path d="M160 352c0-96 48-176 96-176s96 80 96 176" fill="none" stroke="#933c63" stroke-width="34" stroke-linecap="round"/><circle cx="256" cy="140" r="38" fill="#933c63"/></g>
<text x="370" y="230" font-family="Helvetica, Arial" font-size="64" font-weight="700" fill="#ffffff">Pro Güzellik</text>
<text x="372" y="295" font-family="Helvetica, Arial" font-size="32" fill="#f6e7ee">Salonunuzdan kolayca randevu alın</text></svg>`;
await sharp(Buffer.from(svg)).png().toFile("store/google-play/one-cikan-grafik-1024x500.png");
await sharp("assets/icon-only.png").resize(512, 512).png().toFile("store/google-play/uygulama-simgesi-512.png");
await sharp("assets/icon-only.png").png().toFile("store/app-store-simgesi-1024.png");
console.log("ok");
