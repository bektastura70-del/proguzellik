"""İçişleri Bakanlığı e-İçişleri Mülki İdare Bölümleri sayfasından il -> ilçe listesini okur (salt okunur, il başına 1 istek)."""
import html, http.cookiejar, json, re, sys, time, urllib.parse, urllib.request

URL = "https://www.e-icisleri.gov.tr/Anasayfa/MulkiIdariBolumleri.aspx"
OUT = sys.argv[1]
cj = http.cookiejar.CookieJar()
import ssl
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile="/etc/ssl/cert.pem")))
op.addheaders = [("User-Agent", "Mozilla/5.0")]


def get(data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    with op.open(URL, body, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def fields(h):
    out = {}
    for n in ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"]:
        m = re.search(r'name="%s"[^>]*value="([^"]*)"' % n, h) or re.search(r'id="%s" value="([^"]*)"' % n, h)
        out[n] = html.unescape(m.group(1)) if m else ""
    return out


def options(h, name):
    m = re.search(r'name="ctl00\$cph1\$CografiBirimControl\$%s".*?</select>' % name, h, re.S)
    return [(v, html.unescape(t).strip()) for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', m.group(0))] if m else []


first = get()
iller = [(int(v), t) for v, t in options(first, "DropDownListIl") if v != "-1"]
result = []
for code, name in iller:
    data = fields(first)
    data.update({
        "__EVENTTARGET": "ctl00$cph1$CografiBirimControl$DropDownListIl",
        "__EVENTARGUMENT": "", "__LASTFOCUS": "",
        "ctl00$cph1$CografiBirimControl$DropDownListIl": str(code),
    })
    h = get(data)
    ilceler = [(int(v), t) for v, t in options(h, "DropDownListIlce") if v not in ("-1", "")]
    result.append({"code": code, "name": name, "districts": [{"code": c, "name": n} for c, n in ilceler]})
    print(code, name, len(ilceler), file=sys.stderr)
    time.sleep(0.7)

json.dump({"source": URL, "fetchedAt": time.strftime("%Y-%m-%d"), "provinces": result}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("il", len(result), "ilçe", sum(len(p["districts"]) for p in result))
