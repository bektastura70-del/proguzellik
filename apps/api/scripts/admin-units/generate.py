import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
LOW = str.maketrans({"I": "ı", "İ": "i"})
UP = {"i": "İ", "ı": "I"}
def title(s):
    out = []
    for w in s.split(" "):
        w = w.translate(LOW).lower()
        out.append((UP.get(w[0], w[0].upper()) + w[1:]) if w else w)
    return " ".join(out)
ASC = str.maketrans("çğıöşüâîû", "cgiosuaiu")
def slug(s):
    s = s.translate(LOW).lower().translate(ASC)
    return "-".join("".join(ch if ch.isalnum() else " " for ch in s).split())
provs = sorted(d["provinces"], key=lambda p: p["code"])
lines = [
    "/**",
    " * Türkiye il ve ilçeleri (81 il, %d ilçe)." % sum(len(p["districts"]) for p in provs),
    " * Kaynak: T.C. İçişleri Bakanlığı, e-İçişleri \"Mülki İdare Bölümleri\" (%s)," % d["source"],
    " * %s tarihinde il başına bir istekle okundu. Kodlar bakanlığın kodlarıdır (il kodu = plaka kodu)." % d["fetchedAt"],
    " * Adlar kaynağın büyük harfli yazımından Türkçe kurala göre çevrildi; elle eklenen ya da düzeltilen kayıt yoktur.",
    " * Bu dosya üretilmiştir: değiştirmek yerine kaynağı yeniden okuyun.",
    " */",
    "export interface District { code: number; name: string; slug: string }",
    "export interface Province { code: number; name: string; slug: string; districts: readonly District[] }",
    "",
    "export const ADMIN_UNITS_SOURCE = %s;" % json.dumps({"url": d["source"], "fetchedAt": d["fetchedAt"]}, ensure_ascii=False),
    "",
    "export const PROVINCES: readonly Province[] = [",
]
for p in provs:
    ds = sorted(p["districts"], key=lambda x: title(x["name"]).translate(LOW))
    seen = set()
    parts = []
    for x in ds:
        sl = slug(x["name"]); assert sl not in seen, (p["name"], sl); seen.add(sl)
        parts.append('{ code: %d, name: %s, slug: "%s" }' % (x["code"], json.dumps(title(x["name"]), ensure_ascii=False), sl))
    lines.append('  { code: %d, name: %s, slug: "%s", districts: [' % (p["code"], json.dumps(title(p["name"]), ensure_ascii=False), slug(p["name"])))
    for part in parts: lines.append("    " + part + ",")
    lines.append("  ] },")
lines.append("];")
psl = [slug(p["name"]) for p in provs]; assert len(set(psl)) == 81
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("ok")
