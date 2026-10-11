/**
 * Klien JayaPay (https://jaya-pay.vercel.app/docs), channel QRIS Fast.
 *   POST /api/pay/create   { amount, channel, reference }
 *   GET  /api/pay/status?id=ID
 *   POST /api/pay/cancel   { id }
 * Status: pending | settlement | expire | cancel. Siapa yang menanggung fee diatur di dashboard JayaPay.
 */
const { HttpError } = require('./errors');

const base = () => (process.env.JAYAPAY_BASE_URL || 'https://jaya-pay.vercel.app').replace(/\/+$/, '');
const CHANNEL = 'qrisfast';

async function call(path, { method = 'GET', body, query } = {}) {
  const key = process.env.JAYAPAY_API_KEY;
  if (!key) throw new HttpError(503, 'PAYMENT_MISSING', 'Pembayaran belum disiapkan (JAYAPAY_API_KEY kosong).');
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(base() + path + qs, {
      method,
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    if (!r.ok || json?.success === false || (json?.error && !json.id)) {
      const msg = typeof json?.error === 'string' ? json.error : json?.error?.message || json?.message || json?.raw || `HTTP ${r.status}`;
      throw new HttpError(502, 'PAYMENT_ERROR', `JayaPay menolak permintaan: ${msg}`, { upstream_status: r.status });
    }
    return json;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'PAYMENT_UNREACHABLE', e.name === 'AbortError' ? 'JayaPay tidak merespons (timeout).' : 'Gagal menghubungi JayaPay.');
  } finally {
    clearTimeout(timer);
  }
}

/** Respons bisa langsung berupa objek transaksi atau dibungkus di `data`. */
const unwrap = (j) => (j && typeof j === 'object' && !j.id && j.data && typeof j.data === 'object' ? j.data : j);
const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

/** expiry dari JayaPay berformat "YYYY-MM-DD HH:mm:ss" tanpa zona; dari contoh docs, itu waktu WIB (UTC+7). */
function expiryMs(s) {
  if (!s) return null;
  const t = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(s)) ? String(s).replace(' ', 'T') + '+07:00' : String(s);
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

function normalize(j) {
  const d = unwrap(j) || {};
  return {
    id: d.id != null ? String(d.id) : null,
    reference: d.reference ?? null,
    amount: num(d.amount),
    fee: num(d.fee),
    fee_by: d.fee_by ?? null,
    total: num(d.total),
    net: num(d.net),
    status: String(d.status || '').toLowerCase(),
    pay_url: d.pay_url ?? null,
    qr_url: d.qr_url ?? null,
    expiry_at: expiryMs(d.expiry),
    raw: d
  };
}

async function create({ amount, reference }) {
  const r = normalize(await call('/api/pay/create', { method: 'POST', body: { amount, channel: CHANNEL, reference } }));
  if (!r.id) throw new HttpError(502, 'PAYMENT_ERROR', 'JayaPay tidak mengembalikan ID transaksi.');
  return r;
}

const status = async (id) => normalize(await call('/api/pay/status', { query: { id } }));
const cancel = async (id) => normalize(await call('/api/pay/cancel', { method: 'POST', body: { id } }));

module.exports = { create, status, cancel, expiryMs, CHANNEL };
