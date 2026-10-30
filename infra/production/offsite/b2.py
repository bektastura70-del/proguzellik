#!/usr/bin/env python3
"""ProGüzellik sunucu dışı yedek için küçük Backblaze B2 istemcisi (yalnız Python standart kütüphanesi).

Kimlik bilgileri /opt/proguzellik/offsite/b2.env (600) dosyasından okunur ve HİÇBİR çıktıya yazılmaz.
Yalnızca B2_BUCKET içinde ve B2_PREFIX ("proguzellik/") altında çalışır; başka bucket veya nesneye dokunmaz.

Komutlar:
  check                          hesap/bucket/izin/bölge/Object Lock raporu (JSON)
  upload <dosya> <ad> <gün>      yükler; SHA-1 (B2) + SHA-256 (fileInfo) doğrular; <gün> > 0 ise Object Lock saklama
  verify <fileId> <sha256>       uzak nesnenin bilgilerini yeniden okuyup karşılaştırır
  download <ad> <hedef>          indirir (SHA-1 B2 tarafından, SHA-256 çağıran tarafından doğrulanır)
  latest <alt-önek>              alt önek altındaki en yeni nesnenin JSON'u
  prune <alt-önek> <gün>         <gün>'den eski nesne sürümlerini siler (kilitli olanlar atlanır); en yeni nesne asla silinmez
"""
import base64, hashlib, json, os, sys, time, urllib.error, urllib.parse, urllib.request

ENV_FILE = os.environ.get("B2_ENV_FILE", "/opt/proguzellik/offsite/b2.env")
PREFIX = "proguzellik/"


def load_env():
    st = os.stat(ENV_FILE)
    if st.st_mode & 0o077:
        sys.exit(f"HATA: {ENV_FILE} izni 600 olmalı")
    env = {}
    for line in open(ENV_FILE):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v
    for k in ("B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET"):
        if not env.get(k):
            sys.exit(f"HATA: {k} tanımlı değil")
    return env


def req(url, *, data=None, headers=None, method=None, timeout=60):
    r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            msg = json.loads(body).get("code", "") + ": " + json.loads(body).get("message", "")
        except Exception:
            msg = body[:200].decode(errors="replace")
        raise SystemExit(f"HATA: B2 {e.code} {msg}")


class B2:
    def __init__(self):
        self.env = load_env()
        tok = base64.b64encode(f"{self.env['B2_KEY_ID']}:{self.env['B2_APP_KEY']}".encode()).decode()
        _, body, _ = req("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", headers={"Authorization": "Basic " + tok})
        a = json.loads(body)
        s = a["apiInfo"]["storageApi"]
        self.account_id, self.token = a["accountId"], a["authorizationToken"]
        self.api, self.download_url, self.s3 = s["apiUrl"], s["downloadUrl"], s.get("s3ApiUrl", "")
        self.allowed = s.get("allowed") or a.get("allowed") or {}
        self.master = self.env["B2_KEY_ID"] == self.account_id
        self.bucket = self._bucket()

    def call(self, name, payload):
        _, body, _ = req(f"{self.api}/b2api/v3/{name}", data=json.dumps(payload).encode(),
                         headers={"Authorization": self.token, "Content-Type": "application/json"})
        return json.loads(body)

    def _bucket(self):
        r = self.call("b2_list_buckets", {"accountId": self.account_id, "bucketName": self.env["B2_BUCKET"]})
        if not r.get("buckets"):
            sys.exit(f"HATA: bucket bulunamadı veya anahtar erişemiyor: {self.env['B2_BUCKET']}")
        return r["buckets"][0]

    def lock_enabled(self):
        flc = self.bucket.get("fileLockConfiguration") or {}
        return bool(flc.get("isClientAuthorizedToRead") and (flc.get("value") or {}).get("isFileLockEnabled"))

    def check(self):
        caps = sorted(self.allowed.get("capabilities", []))
        abuckets = [b.get("name") for b in (self.allowed.get("buckets") or [])]
        region = self.s3.split(".")[1] if self.s3.count(".") >= 2 else "?"
        flc = self.bucket.get("fileLockConfiguration") or {}
        sse = (self.bucket.get("defaultServerSideEncryption") or {}).get("value") or {}
        need = {"listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"}
        rep = {
            "region": region,
            "s3_endpoint": self.s3,
            "api_url": self.api,
            "bucket": self.bucket["bucketName"],
            "bucket_type": self.bucket["bucketType"],
            "key_restricted_to_buckets": abuckets,
            "key_restricted_to_prefix": self.allowed.get("namePrefix"),
            "capabilities": caps,
            "missing_capabilities": sorted(need - set(caps)),
            "object_lock_enabled": self.lock_enabled(),
            "object_lock_default": (flc.get("value") or {}).get("defaultRetention"),
            "can_write_retention": "writeFileRetentions" in caps,
            "server_side_encryption_default": sse.get("mode"),
        }
        rep["is_master_key"] = self.master
        problems = []
        if self.master:
            problems.append("ana (master) anahtar girildi; yalnız bu bucket'a kısıtlı yeni bir Application Key kullanın")
        if rep["bucket_type"] != "allPrivate":
            problems.append("bucket private değil")
        if abuckets != [self.env["B2_BUCKET"]]:
            problems.append("anahtar yalnız bu bucket'a kısıtlı değil")
        if rep["missing_capabilities"]:
            problems.append("eksik izinler: " + ", ".join(rep["missing_capabilities"]))
        rep["problems"] = problems
        print(json.dumps(rep, ensure_ascii=False, indent=2))
        return 0 if not problems else 2

    def upload(self, path, name, days):
        if not name.startswith(PREFIX):
            sys.exit("HATA: ad proguzellik/ ile başlamalı")
        size = os.path.getsize(path)
        if size > 4 * 1024**3:
            sys.exit("HATA: dosya 4 GB'tan büyük (tek parça sınırı)")
        sha1, sha256 = hashlib.sha1(), hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                sha1.update(chunk); sha256.update(chunk)
        sha1, sha256 = sha1.hexdigest(), sha256.hexdigest()
        u = self.call("b2_get_upload_url", {"bucketId": self.bucket["bucketId"]})
        headers = {
            "Authorization": u["authorizationToken"],
            "X-Bz-File-Name": urllib.parse.quote(name, safe="/"),
            "Content-Type": "application/octet-stream",
            "Content-Length": str(size),
            "X-Bz-Content-Sha1": sha1,
            "X-Bz-Info-sha256": sha256,
            "X-Bz-Server-Side-Encryption": "AES256",
        }
        retention = None
        if days > 0 and self.lock_enabled() and "writeFileRetentions" in self.allowed.get("capabilities", []):
            until = int((time.time() + days * 86400) * 1000)
            mode = self.env.get("B2_LOCK_MODE", "governance")
            headers["X-Bz-File-Retention-Mode"] = mode
            headers["X-Bz-File-Retention-Retain-Until-Timestamp"] = str(until)
            retention = {"mode": mode, "retainUntil": until}
        with open(path, "rb") as f:
            _, body, _ = req(u["uploadUrl"], data=f, headers=headers, method="POST", timeout=600)
        r = json.loads(body)
        if r.get("contentSha1") != sha1:
            sys.exit("HATA: B2 SHA-1 eşleşmedi")
        self.verify(r["fileId"], sha256, quiet=True)
        print(json.dumps({"fileId": r["fileId"], "fileName": r["fileName"], "size": size, "sha256": sha256, "retention": retention}))

    def verify(self, file_id, sha256, quiet=False):
        r = self.call("b2_get_file_info", {"fileId": file_id})
        ok = (r.get("fileInfo") or {}).get("sha256") == sha256 and r.get("action") == "upload"
        if not ok:
            sys.exit("HATA: uzak nesne doğrulanamadı (sha256/fileInfo uyuşmuyor)")
        if not quiet:
            print(json.dumps({"verified": True, "size": r.get("contentLength"), "sha1": r.get("contentSha1")}))

    def versions(self, sub):
        out, start_name, start_id = [], None, None
        while True:
            p = {"bucketId": self.bucket["bucketId"], "prefix": PREFIX + sub, "maxFileCount": 1000}
            if start_name:
                p.update(startFileName=start_name, startFileId=start_id)
            r = self.call("b2_list_file_versions", p)
            out += [f for f in r["files"] if f["action"] == "upload"]
            if not r.get("nextFileName"):
                return out
            start_name, start_id = r["nextFileName"], r.get("nextFileId")

    def latest(self, sub):
        v = sorted(self.versions(sub), key=lambda f: f["uploadTimestamp"])
        if not v:
            sys.exit("HATA: nesne yok")
        f = v[-1]
        print(json.dumps({"fileId": f["fileId"], "fileName": f["fileName"], "sha256": (f.get("fileInfo") or {}).get("sha256"),
                          "uploadTimestamp": f["uploadTimestamp"]}))

    def download(self, name, dest):
        if not name.startswith(PREFIX):
            sys.exit("HATA: ad proguzellik/ ile başlamalı")
        url = f"{self.download_url}/file/{urllib.parse.quote(self.bucket['bucketName'])}/{urllib.parse.quote(name, safe='/')}"
        r = urllib.request.Request(url, headers={"Authorization": self.token})
        with urllib.request.urlopen(r, timeout=600) as resp, open(dest, "wb") as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)
        os.chmod(dest, 0o600)

    def prune(self, sub, days):
        if days < 1:
            sys.exit("HATA: gün >= 1 olmalı")
        cutoff = (time.time() - days * 86400) * 1000
        v = sorted(self.versions(sub), key=lambda f: f["uploadTimestamp"])
        deleted, kept_locked = 0, 0
        for f in v[:-1]:  # en yeni nesne asla silinmez
            if f["uploadTimestamp"] >= cutoff:
                continue
            try:
                self.call("b2_delete_file_version", {"fileName": f["fileName"], "fileId": f["fileId"]})
                deleted += 1
            except SystemExit:
                kept_locked += 1
        print(json.dumps({"deleted": deleted, "skipped_locked_or_error": kept_locked, "remaining": len(v) - deleted}))


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, b = argv[0], B2()
    if cmd == "check":
        return b.check()
    if cmd == "upload":
        return b.upload(argv[1], argv[2], int(argv[3]))
    if cmd == "verify":
        return b.verify(argv[1], argv[2])
    if cmd == "download":
        return b.download(argv[1], argv[2])
    if cmd == "latest":
        return b.latest(argv[1])
    if cmd == "prune":
        return b.prune(argv[1], int(argv[2]))
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
