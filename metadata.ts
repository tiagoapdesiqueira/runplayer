import * as FileSystem from 'expo-file-system';

export interface Metadata {
  title?: string;
  artist?: string;
  artworkUri?: string;
}

const CACHE_DIR = (FileSystem.cacheDirectory ?? '') + 'artwork/';

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function synchsafe(b: Uint8Array, off: number): number {
  return (b[off] << 21) | (b[off + 1] << 14) | (b[off + 2] << 7) | b[off + 3];
}

function readUint32BE(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function decodeText(bytes: Uint8Array, start: number, end: number): string {
  if (start >= end) return '';
  const encoding = bytes[start];
  const data = bytes.subarray(start + 1, end);
  try {
    if (encoding === 0) return decodeLatin1(stripNulls(data));
    if (encoding === 3) return decodeUtf8(stripNulls(data));
    if (encoding === 1) return decodeUtf16WithBom(data);
    if (encoding === 2) return decodeUtf16BE(stripNulls(data));
  } catch {}
  return '';
}

function stripNulls(data: Uint8Array): Uint8Array {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  return data.subarray(0, end);
}

function decodeLatin1(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return s.trim();
}

function decodeUtf8(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8').decode(data).trim();
  } catch {
    return decodeLatin1(data);
  }
}

function decodeUtf16WithBom(data: Uint8Array): string {
  if (data.length < 2) return '';
  const be = data[0] === 0xfe && data[1] === 0xff;
  const le = data[0] === 0xff && data[1] === 0xfe;
  const body = be || le ? data.subarray(2) : data;
  if (be) return decodeUtf16BE(body);
  return decodeUtf16LE(body);
}

function decodeUtf16LE(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < data.length; i += 2) {
    const code = data[i] | (data[i + 1] << 8);
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s.trim();
}

function decodeUtf16BE(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < data.length; i += 2) {
    const code = (data[i] << 8) | data[i + 1];
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s.trim();
}

function findNullTerminator(bytes: Uint8Array, start: number, end: number): number {
  for (let i = start; i < end; i++) if (bytes[i] === 0) return i;
  return -1;
}

function findDoubleNullTerminator(bytes: Uint8Array, start: number, end: number): number {
  for (let i = start; i + 1 < end; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  }
  return -1;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function savePictureFile(
  mime: string,
  bytes: Uint8Array,
  trackKey: string
): Promise<string | undefined> {
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const path = CACHE_DIR + hashString(trackKey) + '.' + ext;
  const existing = await FileSystem.getInfoAsync(path);
  if (existing.exists) return path;
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  const b64 = globalThis.btoa(bin);
  await FileSystem.writeAsStringAsync(path, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

async function parseApic(
  bytes: Uint8Array,
  start: number,
  end: number,
  trackKey: string
): Promise<string | undefined> {
  if (start >= end) return;
  const encoding = bytes[start];
  let pos = start + 1;
  const mimeEnd = findNullTerminator(bytes, pos, end);
  if (mimeEnd < 0) return;
  const mime = decodeLatin1(bytes.subarray(pos, mimeEnd)).toLowerCase();
  pos = mimeEnd + 1;
  if (pos >= end) return;
  pos++;
  if (encoding === 1 || encoding === 2) {
    const descEnd = findDoubleNullTerminator(bytes, pos, end);
    if (descEnd < 0) return;
    pos = descEnd + 2;
  } else {
    const descEnd = findNullTerminator(bytes, pos, end);
    if (descEnd < 0) return;
    pos = descEnd + 1;
  }
  if (pos >= end) return;
  const picture = bytes.subarray(pos, end);
  return savePictureFile(mime || 'image/jpeg', picture, trackKey);
}

export async function readId3(uri: string, trackKey: string): Promise<Metadata> {
  await ensureCacheDir();
  const headerBase64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    length: 10,
    position: 0,
  });
  const header = base64ToBytes(headerBase64);
  if (
    header.length < 10 ||
    header[0] !== 0x49 ||
    header[1] !== 0x44 ||
    header[2] !== 0x33
  ) {
    return {};
  }
  const version = header[3];
  const flags = header[5];
  const tagSize = synchsafe(header, 6);
  const totalRead = Math.min(10 + tagSize, 2 * 1024 * 1024);

  const fullBase64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    length: totalRead,
    position: 0,
  });
  const bytes = base64ToBytes(fullBase64);
  const end = Math.min(10 + tagSize, bytes.length);

  let pos = 10;
  if (flags & 0x40) {
    if (pos + 4 > end) return {};
    const extSize = version === 4 ? synchsafe(bytes, pos) : readUint32BE(bytes, pos);
    pos += extSize + 4;
  }

  const result: Metadata = {};
  while (pos + 10 <= end) {
    const id =
      String.fromCharCode(bytes[pos]) +
      String.fromCharCode(bytes[pos + 1]) +
      String.fromCharCode(bytes[pos + 2]) +
      String.fromCharCode(bytes[pos + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize =
      version === 4 ? synchsafe(bytes, pos + 4) : readUint32BE(bytes, pos + 4);
    if (frameSize <= 0) break;
    const frameStart = pos + 10;
    const frameEnd = frameStart + frameSize;
    if (frameEnd > end) break;

    if (id === 'TIT2') {
      result.title = decodeText(bytes, frameStart, frameEnd);
    } else if (id === 'TPE1') {
      result.artist = decodeText(bytes, frameStart, frameEnd);
    } else if (id === 'APIC') {
      try {
        result.artworkUri = await parseApic(bytes, frameStart, frameEnd, trackKey);
      } catch {}
    }

    pos = frameEnd;
  }

  return result;
}

export async function clearArtworkCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  } catch {}
}
