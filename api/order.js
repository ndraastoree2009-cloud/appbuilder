// Satu pesanan.
//   GET  /api/order?id=ID                 status terbaru (memeriksa JayaPay / GitHub bila perlu)
//   POST /api/order {id, action}          action: cancel | retry
//   GET  /api/order?id=ID&download=1&t=…  unduh APK (tautan bertanda 10 menit dari respons status)
const { route, fail, HttpError } = require('../lib/http');
const store = require('../lib/store');
const orders = require('../lib/orders');
const flow = require('../lib/flow');
const github = require('../lib/github');
const session = require('../lib/session');

const handler = route(
  ['GET', 'POST'],
  async ({ method, query, body, auth, base }) => {
    const id = String((method === 'GET' ? query.id : body.id) || '');
    let o = await orders.get(id);
    if (!o || (auth.role === 'user' && o.uid !== auth.id)) throw new HttpError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.');
    if (method === 'POST') {
      if (body.action === 'cancel') o = await flow.cancel(o, base);
      else if (body.action === 'retry') o = await flow.retry(o, base, auth.role === 'admin');
      else throw new HttpError(422, 'VALIDATION', 'action harus cancel atau retry.');
    } else {
      o = await flow.refresh(o, base);
    }
    return flow.view(o, { admin: auth.role === 'admin' });
  },
  { auth: 'any' }
);

async function download(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!store.enabled()) throw new HttpError(503, 'STORE_MISSING', 'Penyimpanan belum disiapkan.');
    const id = String(req.query.id || '');
    if (!session.checkLink('dl', id, req.query.t)) {
      throw new HttpError(403, 'FORBIDDEN', 'Tautan unduhan tidak valid atau kedaluwarsa. Muat ulang halaman pesanan.');
    }
    const o = await orders.get(id);
    if (!o || o.status !== 'paid' || o.build !== 'done') throw new HttpError(404, 'NOT_FOUND', 'APK belum tersedia.');
    const asset = await github.releaseAsset(id);
    if (!asset) throw new HttpError(404, 'NOT_FOUND', 'APK tidak ditemukan.');
    res.statusCode = 302;
    res.setHeader('Location', await github.assetLocation(asset));
    res.end();
  } catch (e) {
    fail(res, e);
  }
}

module.exports = (req, res) => (req.method === 'GET' && req.query && req.query.download ? download(req, res) : handler(req, res));
