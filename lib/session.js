/**
 * Sesi tanpa database: token bertanda tangan HMAC.
 * - st.<payload>.<tanda tangan>  untuk login (user 30 hari, admin 12 jam)
 * - tautan bertanda waktu (unduh APK, ikon) untuk akses tanpa header Authorization
 * Rahasia user diturunkan dari SESSION_SECRET; rahasia admin ditambah ADMIN_PASSWORD,
 * jadi mengganti password admin otomatis mencabut semua sesi admin.
 */
const crypto = require('crypto');
const { HttpError } = require('./errors');

const b64 = (b) => Buffer.from(b).toString('base64url');

function secret(kind) {
  const base = process.env.SESSION_SECRET;
  if (!base || base.length < 16) {
    throw new HttpError(500, 'SERVER_MISCONFIGURED', 'Isi SESSION_SECRET (minimal 16 karakter) di environment Vercel.');
  }
  const extra = kind === 'admin' ? process.env.ADMIN_PASSWORD || '' : '';
  return crypto.createHash('sha256').update(`w2a|${kind}|${base}|${extra}`).digest();
}

const sign = (kind, data) => crypto.createHmac('sha256', secret(kind)).update(data).digest('base64url');

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function issue(claims, ttlMs) {
  const exp = Date.now() + ttlMs;
  const payload = b64(JSON.stringify({ ...claims, exp }));
  return { token: `st.${payload}.${sign(claims.r, payload)}`, expires_at: exp };
}

/** Mengembalikan klaim bila token sah dan belum kedaluwarsa, selain itu null. */
function verify(token) {
  const m = /^st\.([\w-]+)\.([\w-]+)$/.exec(String(token || ''));
  if (!m) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(m[1], 'base64url').toString());
  } catch {
    return null;
  }
  if (!p || (p.r !== 'user' && p.r !== 'admin')) return null;
  if (p.r === 'admin' && !process.env.ADMIN_PASSWORD) return null;
  return same(sign(p.r, m[1]), m[2]) && p.exp > Date.now() ? p : null;
}

/** Tautan bertanda: `<exp>.<sig>`, terikat ke jenis dan id. */
function link(kind, id, ttlMs) {
  const exp = Date.now() + ttlMs;
  return `${exp}.${sign('link', `${kind}|${id}|${exp}`)}`;
}

function checkLink(kind, id, t) {
  const m = /^(\d{13})\.([\w-]+)$/.exec(String(t || ''));
  if (!m || Number(m[1]) < Date.now()) return false;
  return same(sign('link', `${kind}|${id}|${m[1]}`), m[2]);
}

module.exports = { issue, verify, link, checkLink };
