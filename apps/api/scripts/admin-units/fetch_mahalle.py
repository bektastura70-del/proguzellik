"""e-İçişleri Mülki İdare Bölümleri: il başına resmî "Mahallelerin Listesi" (Excel) raporunu indirir (salt okunur, il başına
birkaç istek). Çıktı: [{il, path, name}] ham JSON (adlar kaynaktaki gibi büyük harf). Gerekli: pip install xlrd.
Kullanım: python3 -I fetch_mahalle.py <tr-admin-units il kodları için generate.py girdisi değil> <çıktı.json>"""
import html, http.cookiejar, json, re, ssl, sys, time, urllib.parse, urllib.request
import xlrd

URL = "https://www.e-icisleri.gov.tr/Anasayfa/MulkiIdariBolumleri.aspx"
P = "ctl00$cph1$CografiBirimControl$"
OUT = sys.argv[1]
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile="/etc/ssl/cert.pem")))
op.addheaders = [("User-Agent", "Mozilla/5.0")]


def post(d=None):
    with op.open(URL, urllib.parse.urlencode(d).encode() if d else None, timeout=90) as r:
        return r.headers.get("Content-Type", ""), r.read()


def fields(h):
    o = {}
    for n in ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"]:
        m = re.search(r'id="%s" value="([^"]*)"' % n, h)
        o[n] = html.unescape(m.group(1)) if m else ""
    return o


_, b = post()
first = b.decode("utf-8", "replace")
codes = [int(v) for v in re.findall(r'<option[^>]*value="(\d+)"', re.search(r'name="%sDropDownListIl".*?</select>' % re.escape(P), first, re.S).group(0))]
out = []
for il in codes:
    d = fields(first)
    d.update({"__EVENTTARGET": P + "DropDownListIl", "__EVENTARGUMENT": "", "__LASTFOCUS": "", P + "DropDownListIl": str(il)})
    _, b = post(d)
    h = b.decode("utf-8", "replace")
    d = fields(h)
    d.update({"__EVENTTARGET": "", "__EVENTARGUMENT": "", "__LASTFOCUS": "", P + "DropDownListIl": str(il), P + "DropDownListIlce": "-1",
              P + "DropDownListTip": "6", P + "DropDownListRaporSekli": "Alfabetik", P + "DropDownListRaporTipi": "EXCEL",
              P + "ButtonRaporOlustur": "Rapor Oluştur"})
    ct, b = post(d)
    if "excel" not in ct:
        sys.exit(f"il {il}: Excel gelmedi ({ct})")
    s = xlrd.open_workbook(file_contents=b, logfile=open("/dev/null", "w")).sheet_by_index(0)
    n = 0
    for r in range(s.nrows):
        row = [str(c.value).strip() for c in s.row(r)]
        if re.fullmatch(r"\d+(\.0)?", row[0]) and row[3] and row[5]:
            out.append({"il": il, "path": row[5], "name": row[3]})
            n += 1
    print(il, n, file=sys.stderr)
    time.sleep(1)

json.dump({"source": URL + " (Mahallelerin Listesi, Excel)", "fetchedAt": time.strftime("%Y-%m-%d"), "rows": out}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("mahalle", len(out))
