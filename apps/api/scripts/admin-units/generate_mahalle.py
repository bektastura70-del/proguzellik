"""fetch_mahalle.py çıktısından src/directory/tr-neighborhoods.ts üretir. İlçe eşleştirmesi tr-admin-units.ts'teki adlarla
yapılır; eşleşmeyen tek kayıt varsa durur. Kullanım: python3 -I generate_mahalle.py <ham.json> <tr-admin-units.ts> <çıktı.ts>"""
import json, re, sys
raw = json.load(open(sys.argv[1], encoding="utf-8"))
units = open(sys.argv[2], encoding="utf-8").read()
LOW = str.maketrans({"I": "ı", "İ": "i"})
UP = {"i": "İ", "ı": "I"}
ASC = str.maketrans("çğıöşüâîû", "cgiosuaiu")
def lower(s): return s.translate(LOW).lower()
def upper_tr(s): return "".join(UP.get(c, c.upper()) for c in s)
def title(s):
    s = lower(s)
    return re.sub(r"(^|[\s\-(./])(\w)", lambda m: m.group(1) + UP.get(m.group(2), m.group(2).upper()), s)
def slug(s):
    s = lower(s).translate(ASC)
    return "-".join("".join(ch if ch.isalnum() else " " for ch in s).split())

# il kodu -> {BÜYÜK HARF ilçe adı: ilçe kodu}
prov = {}
cur = None
for line in units.splitlines():
    m = re.match(r'  \{ code: (\d+), name: "([^"]+)", slug: "[^"]+", districts: \[', line)
    if m:
        cur = int(m.group(1)); prov[cur] = (m.group(2), {})
        continue
    m = re.match(r'    \{ code: (\d+), name: "([^"]+)"', line)
    if m and cur is not None:
        prov[cur][1][upper_tr(m.group(2))] = int(m.group(1))
assert len(prov) == 81, len(prov)

by_district = {}
for r in raw["rows"]:
    pname, dists = prov[r["il"]]
    parts = [p.strip() for p in r["path"].split("->")]
    assert parts[0] == upper_tr(pname), (r, pname)
    if len(parts) == 2:  # "İL -> İL-İL MERKEZİ" (Afyonkarahisar'da "İL -> İL"): merkez ilçe
        ilce, belde = "MERKEZ", None
    else:
        assert len(parts) == 3, r
        ilce = parts[1]
        belde = None if parts[2].endswith("İLÇE MERKEZİ") else parts[2]
    code = dists.get(ilce)
    assert code is not None, ("ilçe eşleşmedi", r)
    name = re.sub(r"\s+", " ", r["name"]).strip()
    # Birkaç kayıtta ad "… MAHALLESİ" diye bitiyor; ek gösterimde eklendiği için atılır.
    name = re.sub(r"\s+MAHALLES[İI]$", "", name)
    assert name, r
    by_district.setdefault(code, []).append((name, belde))

out = {}
total = 0
for code, items in by_district.items():
    seen = {}
    rows = []
    for name, belde in items:
        s = slug(name) + ("--" + slug(belde) if belde else "")
        if s in seen:
            # Kaynakta aynı yerde aynı adla iki kez geçen 3 kayıt var (Efeler Yeniköy, Altınordu Güzelyalı, Mesudiye
            # Kayadibi); adres metni aynı olduğundan tek seçenek yeterli.
            assert seen[s] == (name, belde), ("aynı ilçede aynı kod", code, name, belde)
            continue
        seen[s] = (name, belde)
        rows.append([s, title(name)] + ([title(belde)] if belde else []))
    rows.sort(key=lambda x: x[0])
    out[code] = rows
    total += len(rows)

lines = [
    "/**",
    " * Türkiye mahalleleri (%d mahalle, %d ilçe). Köyler yoktur." % (total, len(out)),
    " * Kaynak: T.C. İçişleri Bakanlığı, e-İçişleri \"Mülki İdare Bölümleri\", il başına \"Mahallelerin Listesi\" (Excel),",
    " * %s tarihinde okundu (scripts/admin-units/fetch_mahalle.py + generate_mahalle.py). Kaynakta mahalle kodu yoktur;" % raw["fetchedAt"],
    " * kod = mahalle adının sadeleştirilmiş hâli (beldedeki mahallede \"--<belde>\" eki), ilçe içinde benzersiz.",
    " * Biçim: ilçe kodu -> [kod, ad, belde?][] (ad \"Mahallesi\" eki olmadan). Elle düzenlemeyin.",
    " */",
    "export const NEIGHBORHOODS: Readonly<Record<number, readonly (readonly [string, string, string?])[]>> = {",
]
for code in sorted(out):
    lines.append("  %d: %s," % (code, json.dumps(out[code], ensure_ascii=False, separators=(",", ":"))))
lines.append("};")
lines.append("")
open(sys.argv[3], "w", encoding="utf-8").write("\n".join(lines))
print("mahalle", total, "ilçe", len(out))
