/**
 * Yüklenen marka görselinin güvenli denetimi (harici kütüphane olmadan):
 * - Tür yalnızca dosyanın ilk baytlarından (magic bytes) belirlenir; istemcinin bildirdiği türe güvenilmez.
 * - Yalnızca PNG / JPEG / WebP kabul edilir (SVG yok: betik içerebilir).
 * - Boyutlar dosya başlığından okunur; bozuk/kesik dosya reddedilir.
 * - Konum vb. kişisel veri içerebilecek üst veri (EXIF/XMP/metin parçaları) silinir.
 */
export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export interface InspectedImage {
  mime: ImageMime;
  width: number;
  height: number;
  bytes: Buffer;
}

export class ImageError extends Error {}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectImage(buf: Buffer): InspectedImage {
  if (buf.length < 16) throw new ImageError("Dosya geçerli bir görsel değil");
  if (buf.subarray(0, 8).equals(PNG_SIG)) return png(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return jpeg(buf);
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return webp(buf);
  throw new ImageError("Yalnızca PNG, JPEG veya WebP yükleyebilirsiniz");
}

function png(buf: Buffer): InspectedImage {
  const keep: Buffer[] = [PNG_SIG];
  let off = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  const DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const end = off + 12 + len;
    if (end > buf.length) throw new ImageError("PNG dosyası bozuk");
    if (off === 8) {
      if (type !== "IHDR" || len !== 13) throw new ImageError("PNG dosyası bozuk");
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
    }
    if (!DROP.has(type)) keep.push(buf.subarray(off, end));
    off = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !width || !height) throw new ImageError("PNG dosyası bozuk");
  return { mime: "image/png", width, height, bytes: Buffer.concat(keep) };
}

function jpeg(buf: Buffer): InspectedImage {
  const keep: Buffer[] = [buf.subarray(0, 2)];
  let off = 2;
  let width = 0;
  let height = 0;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) throw new ImageError("JPEG dosyası bozuk");
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    if (marker === 0xda) {
      // Tarama verisi: geri kalanı olduğu gibi (görüntü verisi) eklenir.
      keep.push(buf.subarray(off));
      break;
    }
    const len = buf.readUInt16BE(off + 2);
    const end = off + 2 + len;
    if (len < 2 || end > buf.length) throw new ImageError("JPEG dosyası bozuk");
    // SOF0..SOF15 (DHT/JPG/DAC hariç): boyutlar
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      height = buf.readUInt16BE(off + 5);
      width = buf.readUInt16BE(off + 7);
    }
    // APP1..APP15 (EXIF/XMP/…) ve yorum (COM) silinir; APP0 (JFIF) korunur.
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) keep.push(buf.subarray(off, end));
    off = end;
  }
  if (!width || !height) throw new ImageError("JPEG dosyası bozuk");
  return { mime: "image/jpeg", width, height, bytes: Buffer.concat(keep) };
}

function webp(buf: Buffer): InspectedImage {
  let off = 12;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];
  let vp8xIndex = -1;
  while (off + 8 <= buf.length) {
    const type = buf.toString("ascii", off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    const end = off + 8 + len + (len % 2);
    if (off + 8 + len > buf.length) throw new ImageError("WebP dosyası bozuk");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "VP8X" && len >= 10) {
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
      vp8xIndex = chunks.length;
    } else if (type === "VP8 " && !width && len >= 10) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === "VP8L" && !width && len >= 5) {
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (type !== "EXIF" && type !== "XMP ") chunks.push(Buffer.from(buf.subarray(off, Math.min(end, buf.length))));
    off = end;
  }
  if (!width || !height) throw new ImageError("WebP dosyası bozuk");
  if (vp8xIndex >= 0) chunks[vp8xIndex][8] &= ~(0x08 | 0x04); // EXIF ve XMP bayrakları
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return { mime: "image/webp", width, height, bytes: Buffer.concat([header, body]) };
}
