// Callback dari workflow GitHub: POST { order_id, status: building|done|failed, run_url, message }
// Dilindungi header x-build-secret (sama dengan env BUILD_SECRET dan secret BUILD_SECRET di GitHub).
const crypto = require('crypto');
const { route, HttpError } = require('../lib/http');
const orders = require('../lib/orders');
const flow = require('../lib/flow');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

module.exports = route(
  'POST',
  async ({ req, body }) => {
    const want = process.env.BUILD_SECRET;
    if (!want || want.length < 16) throw new HttpError(500, 'SERVER_MISCONFIGURED', 'BUILD_SECRET belum diatur (minimal 16 karakter).');
    if (!crypto.timingSafeEqual(digest(req.headers['x-build-secret'] || ''), digest(want))) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Secret tidak valid.');
    }
    const o = await orders.get(String(body.order_id || ''));
    if (!o) throw new HttpError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.');
    await flow.buildEvent(o, body);
    return { ok: true };
  },
  { auth: 'none' }
);
