"use client";

import { Copy, Download, MessageCircle, Printer, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, useToast } from "@/components/ui";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fileSafe = (s: string) => s.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "salon";

/**
 * Salonun QR kodu ve kısa bağlantısı: resepsiyona asmak, WhatsApp'ta göndermek için.
 * Bağlantı /r/{slug}: uygulama açıkken salon uygulamasına yönlenir, kapatılırsa eski online randevu sayfası açılır
 * (basılı afişler geri almada bozulmaz). QR siyah-beyazdır (her kamerada okunur).
 */
export function SalonQrCard({ slug, salonName }: { slug: string; salonName: string }) {
  const toast = useToast();
  const [origin, setOrigin] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}/r/${slug}` : null;
  const shortText = url?.replace(/^https?:\/\//, "") ?? "";
  const local = !!origin && /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);

  useEffect(() => {
    if (!url) return;
    const opts = { margin: 2, errorCorrectionLevel: "M" as const, color: { dark: "#000000", light: "#ffffff" } };
    QRCode.toDataURL(url, { ...opts, width: 1024 }).then(setPng).catch(() => setPng(null));
    QRCode.toString(url, { ...opts, type: "svg" }).then(setSvg).catch(() => setSvg(null));
  }, [url]);

  const message = url ? `${salonName} uygulamasını telefonunuza ekleyin; randevu alın, hatırlatmaları anında alın: ${url}` : "";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Bağlantı kopyalandı");
    } catch {
      window.prompt("Bağlantıyı kopyalayın:", url);
    }
  }

  function printPoster() {
    if (!png || !url) return;
    const w = window.open("", "_blank");
    if (!w) return toast("Açılır pencere engellendi; tarayıcıda bu site için izin verin");
    w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(salonName)} · QR afiş</title>
<style>
@page{size:A5 portrait;margin:12mm}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f1a17;text-align:center}
.p{max-width:148mm;margin:0 auto;padding:6mm 0}
h1{font-size:26pt;margin:0 0 2mm}h2{font-size:15pt;font-weight:600;margin:0 0 6mm}
img{width:95mm;height:95mm;display:block;margin:0 auto}
.u{font-size:13pt;font-weight:700;margin:4mm 0 6mm;word-break:break-all}
.s{display:flex;gap:6mm;text-align:left;font-size:10.5pt;line-height:1.4}.s div{flex:1;border:1px solid #ddd;border-radius:4mm;padding:3mm 4mm}
.s b{display:block;margin-bottom:1mm}
.n{font-size:8.5pt;color:#666;margin-top:5mm}
button{margin-top:6mm;font-size:12pt;padding:3mm 6mm}@media print{button{display:none}}
</style></head><body><div class="p">
<h1>${esc(salonName)}</h1><h2>Uygulamamızı telefonunuza ekleyin</h2>
<img src="${png}" alt="QR kod">
<div class="u">${esc(shortText)}</div>
<div class="s"><div><b>Android</b>Kamerayla okutun, açılan sayfada <b style="display:inline">Uygulamayı yükle</b>'ye dokunun.</div>
<div><b>iPhone</b>Kamerayla okutun, Safari'de Paylaş → <b style="display:inline">Ana Ekrana Ekle</b>.</div></div>
<p class="n">Randevu alın, randevu onayı ve hatırlatmaları anında alın. Mağazadan indirmeniz gerekmez.</p>
<button onclick="window.print()">Yazdır</button></div>
<script>document.querySelector("img").addEventListener("load",function(){setTimeout(function(){window.print()},200)})</script>
</body></html>`);
    w.document.close();
  }

  const base = `${fileSafe(slug)}-qr`;
  return (
    <Card>
      <CardHeader title="QR kod ve bağlantı" description="Resepsiyona asın veya müşterilerinize WhatsApp'tan gönderin. Okutan müşteri uygulamayı tek adımda telefonuna ekler." />
      <CardBody className="space-y-3">
        {local && <Alert tone="amber">Bu sayfayı yerel adresten açtınız; QR kod yalnızca bu bilgisayarda çalışır. Basmadan önce canlı panelden indirin.</Alert>}
        <div className="flex justify-center">
          {png ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={png} alt={`${salonName} uygulaması QR kodu`} width={176} height={176} className="size-44 rounded-xl border border-sand-200 bg-white" data-testid="salon-qr" />
          ) : (
            <div className="grid size-44 place-items-center rounded-xl border border-dashed border-sand-300 text-neutral-400"><QrCode className="size-8" aria-hidden /></div>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-sand-50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium" data-testid="salon-link">{shortText}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => void copy()} aria-label="Bağlantıyı kopyala"><Copy className="size-4" aria-hidden /></Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a href={png ?? undefined} download={`${base}.png`} aria-disabled={!png} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 text-sm font-medium hover:bg-sand-50">
            <Download className="size-4" aria-hidden /> PNG indir
          </a>
          <a href={svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined} download={`${base}.svg`} aria-disabled={!svg} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 text-sm font-medium hover:bg-sand-50">
            <Download className="size-4" aria-hidden /> SVG indir
          </a>
          <Button type="button" variant="secondary" size="sm" className="min-h-10" disabled={!png} onClick={printPoster}><Printer className="size-4" aria-hidden /> Afiş yazdır</Button>
          <a href={url ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 text-sm font-medium hover:bg-sand-50">
            <MessageCircle className="size-4" aria-hidden /> WhatsApp'ta paylaş
          </a>
        </div>
      </CardBody>
    </Card>
  );
}
