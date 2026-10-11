/** Validasi input pesanan dan pengaturan. Semua pesan ditujukan ke pengguna akhir. */
const crypto = require('crypto');
const { HttpError } = require('./errors');

const bad = (msg) => new HttpError(422, 'VALIDATION', msg);
const NAME_RE = /^[\p{L}\p{N} .,&'+!_-]{2,30}$/u;
const PKG_RE = /^[a-z][a-z0-9_]{0,19}(\.[a-z][a-z0-9_]{0,19}){2,4}$/;
const RESERVED = ['android.', 'com.android.', 'com.google.android.', 'java.', 'javax.', 'kotlin.'];
const HEX = /^#[0-9a-fA-F]{6}$/;

function appName(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!NAME_RE.test(s)) throw bad("Nama aplikasi 2 sampai 30 karakter: huruf, angka, spasi, dan . , & ' + ! _ -");
  return s;
}

function appUrl(v) {
  let s = String(v ?? '').trim();
  if (/^http:\/\//i.test(s)) throw bad('Hanya situs https:// yang didukung. Pastikan situsmu memakai HTTPS.');
  if (!/^https:\/\//i.test(s)) s = 'https://' + s;
  if (s.length > 300) throw bad('Alamat situs terlalu panjang.');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad('Alamat situs tidak valid. Contoh: https://tokosaya.com');
  }
  const h = u.hostname.toLowerCase();
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[');
  if (u.protocol !== 'https:' || u.username || u.password || !h.includes('.') || ip || h === 'localhost' || /\.(local|internal|localhost)$/.test(h)) {
    throw bad('Alamat situs harus berupa situs publik, contoh https://tokosaya.com');
  }
  return u.toString();
}

function color(v, fallback) {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  if (!HEX.test(s)) throw bad('Warna harus berformat #RRGGBB.');
  return s.toLowerCase();
}

function packageName(v, url) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) {
    const host = new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
    const slug = (/^[a-z]/.test(host) ? host : 'a' + host).slice(0, 18) || 'app';
    return `app.w2a.${slug}`;
  }
  if (s.length > 60 || !PKG_RE.test(s) || RESERVED.some((r) => (s + '.').startsWith(r))) {
    throw bad('Package name tidak valid. Contoh: com.tokosaya.app (huruf kecil, angka, titik, minimal 3 bagian).');
  }
  return s;
}

/** Gambar dari data URL (png/jpeg/webp). Mengembalikan { mime, bytes, dataUrl }. */
function image(v, maxBytes, label) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(v ?? ''));
  if (!m || m[2].length > Math.ceil((maxBytes * 4) / 3) + 8) {
    throw bad(`${label} harus berupa gambar PNG, JPEG, atau WebP maksimal ${Math.round(maxBytes / 1024)} KB.`);
  }
  const bytes = Buffer.from(m[2], 'base64');
  const png = bytes.subarray(0, 4).toString('hex') === '89504e47';
  const jpg = bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
  const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  const kind = png ? 'png' : jpg ? 'jpeg' : webp ? 'webp' : null;
  if (!kind || kind !== m[1] || bytes.length > maxBytes) {
    throw bad(`${label} harus berupa gambar PNG, JPEG, atau WebP maksimal ${Math.round(maxBytes / 1024)} KB.`);
  }
  return { mime: `image/${kind}`, bytes, dataUrl: v };
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const orderId = () => crypto.randomBytes(8).toString('hex').toUpperCase();

module.exports = { appName, appUrl, color, packageName, image, clean, orderId, HEX, bad };
