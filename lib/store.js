/**
 * Penyimpanan tipis di atas Redis REST (Upstash / Vercel KV), tanpa dependency.
 * Dipakai untuk API key user, log aktivitas, dan kunci idempotensi.
 * Env yang dikenali: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN,
 * atau KV_REST_API_URL + KV_REST_API_TOKEN.
 */
const { HttpError } = require('./errors');

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

const enabled = () => !!config();

async function send(path, payload) {
  const c = config();
  if (!c) {
    throw new HttpError(
      503,
      'STORE_MISSING',
      'Penyimpanan belum disiapkan. Hubungkan Upstash Redis / Vercel KV dan isi env UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (atau KV_REST_API_URL + KV_REST_API_TOKEN).'
    );
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(c.url + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error('store error:', e.message);
    throw new HttpError(503, 'STORE_ERROR', 'Gagal menghubungi penyimpanan (Redis).');
  } finally {
    clearTimeout(timer);
  }
}

async function cmd(...args) {
  const j = await send('', args.map((a) => (typeof a === 'number' ? String(a) : a)));
  if (j.error) throw new HttpError(503, 'STORE_ERROR', 'Penyimpanan menolak perintah.');
  return j.result;
}

async function pipeline(cmds) {
  const j = await send('/pipeline', cmds);
  return Array.isArray(j) ? j.map((x) => x.result) : [];
}

// Hasil HGETALL bisa berupa array datar [k, v, k, v] atau objek, tergantung konfigurasi.
function pairs(res) {
  if (!res) return {};
  if (Array.isArray(res)) {
    const o = {};
    for (let i = 0; i < res.length; i += 2) o[res[i]] = res[i + 1];
    return o;
  }
  return res;
}

module.exports = { enabled, cmd, pipeline, pairs };
