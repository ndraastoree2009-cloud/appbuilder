const crypto = require('crypto');
const { HttpError } = require('./errors');
const session = require('./session');
const users = require('./users');
const store = require('./store');

const ip = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);

/** URL dasar situs: SITE_URL bila diisi, selain itu dari header host. */
function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  return `https://${req.headers.host}`;
}

async function authenticate(req) {
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!given) throw new HttpError(401, 'UNAUTHORIZED', 'Masuk dulu untuk melanjutkan.');
  const p = session.verify(given);
  if (!p) throw new HttpError(401, 'SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk lagi.');
  if (p.r === 'admin') return { role: 'admin', id: 'admin', label: p.n || 'Admin' };
  const u = await users.get(p.u);
  if (!u) throw new HttpError(401, 'SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk lagi.');
  if (u.disabled) throw new HttpError(403, 'ACCOUNT_DISABLED', 'Akun ini dinonaktifkan. Hubungi admin.');
  return { role: 'user', id: u.id, label: u.name, user: u };
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      throw new HttpError(400, 'INVALID_JSON', 'Body harus berupa JSON yang valid.');
    }
  }
  return b && typeof b === 'object' ? b : {};
}

function fail(res, e) {
  const known = e instanceof HttpError;
  if (!known) console.error(e);
  res.status(known ? e.status : 500).json({
    success: false,
    error: {
      code: known ? e.code : 'INTERNAL_ERROR',
      message: known ? e.message : 'Terjadi kesalahan internal.',
      details: known ? e.details : undefined
    }
  });
}

/**
 * Bungkus handler: cek method, autentikasi, format respons seragam.
 * opts.auth: 'user' (default) | 'admin' | 'any' (user atau admin) | 'none'
 */
function route(methods, fn, opts = {}) {
  const allowed = [].concat(methods);
  const need = opts.auth || 'user';
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!allowed.includes(req.method)) {
        res.setHeader('Allow', allowed.join(', '));
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Gunakan method ${allowed.join(' atau ')} untuk endpoint ini.`);
      }
      if (!store.enabled()) {
        throw new HttpError(503, 'STORE_MISSING', 'Penyimpanan belum disiapkan. Hubungkan Upstash Redis / Vercel KV ke proyek.');
      }
      const auth = need === 'none' ? null : await authenticate(req);
      if (need === 'admin' && auth.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Hanya untuk admin.');
      if (need === 'user' && auth.role !== 'user') throw new HttpError(403, 'FORBIDDEN', 'Endpoint ini hanya untuk pengguna.');
      const data = await fn({
        req,
        method: req.method,
        body: req.method === 'GET' ? {} : readBody(req),
        query: req.query || {},
        auth,
        base: baseUrl(req)
      });
      res.status(200).json({ success: true, data });
    } catch (e) {
      fail(res, e);
    }
  };
}

/** Satu file serverless melayani beberapa endpoint lewat segmen dinamis (hemat kuota fungsi Vercel Hobby). */
function dispatch(handlers, param) {
  return (req, res) => {
    const name = String((req.query || {})[param] || '');
    const h = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
    if (!h) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
    }
    return h(req, res);
  };
}

/** Batasi jumlah permintaan per jendela waktu (butuh Redis). */
async function limit(bucket, max, windowS, message) {
  const k = `w2a:rl:${bucket}`;
  const n = Number(await store.cmd('INCR', k));
  if (n === 1) await store.cmd('EXPIRE', k, windowS);
  if (n > max) throw new HttpError(429, 'TOO_MANY_REQUESTS', message || 'Terlalu banyak permintaan. Coba lagi nanti.');
}

/** Hitung hanya kegagalan (mis. salah password), blokir setelah `max` kali. */
const strikes = {
  async check(bucket, max) {
    const n = Number(await store.cmd('GET', `w2a:rl:${bucket}`)) || 0;
    if (n >= max) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
  },
  async hit(bucket, windowS) {
    const k = `w2a:rl:${bucket}`;
    const n = Number(await store.cmd('INCR', k));
    if (n === 1) await store.cmd('EXPIRE', k, windowS);
  },
  clear: (bucket) => store.cmd('DEL', `w2a:rl:${bucket}`)
};

module.exports = { HttpError, route, dispatch, fail, readBody, ip, sha, limit, strikes, baseUrl };
