// Ikon pesanan untuk runner build. Hanya bisa diakses dengan tautan bertanda (berlaku 2 jam).
const store = require('../lib/store');
const orders = require('../lib/orders');
const session = require('../lib/session');
const { fail } = require('../lib/http');
const { HttpError } = require('../lib/errors');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Gunakan method GET untuk endpoint ini.');
    if (!store.enabled()) throw new HttpError(503, 'STORE_MISSING', 'Penyimpanan belum disiapkan.');
    const id = String((req.query || {}).id || '');
    if (!session.checkLink('icon', id, (req.query || {}).t)) throw new HttpError(403, 'FORBIDDEN', 'Tautan tidak valid atau kedaluwarsa.');
    const data = await orders.icon(id);
    const m = data && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(data);
    if (!m) throw new HttpError(404, 'NOT_FOUND', 'Ikon tidak ditemukan.');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', m[1]);
    res.status(200).end(Buffer.from(m[2], 'base64'));
  } catch (e) {
    fail(res, e);
  }
};
