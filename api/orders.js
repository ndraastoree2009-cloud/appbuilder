// Pesanan milik user.
//   GET  /api/orders?page=1   daftar pesanan
//   POST /api/orders          buat pesanan + transaksi QRIS Fast { app_name, app_url, color?, package?, icon? }
const { route, HttpError, limit } = require('../lib/http');
const orders = require('../lib/orders');
const settings = require('../lib/settings');
const jayapay = require('../lib/jayapay');
const flow = require('../lib/flow');
const v = require('../lib/validate');

const PAGE = 20;
const MAX_PENDING = 3;

module.exports = route(['GET', 'POST'], async ({ method, query, body, auth }) => {
  if (method === 'GET') {
    const page = Math.max(1, Number(query.page) || 1);
    const [items, total] = await Promise.all([orders.listMine(auth.id, (page - 1) * PAGE, PAGE), orders.countMine(auth.id)]);
    return { page, per_page: PAGE, total, items: items.map((o) => flow.view(o)) };
  }

  const name = v.appName(body.app_name);
  const url = v.appUrl(body.app_url);
  const s = await settings.get();
  const color = v.color(body.color, s.brand_color);
  const pkg = v.packageName(body.package, url);
  const icon = body.icon ? v.image(body.icon, 300 * 1024, 'Ikon') : null;

  const recent = await orders.listMine(auth.id, 0, 20);
  const open = recent.filter((o) => o.status === 'pending' && !(o.pay.expiry_at && o.pay.expiry_at < Date.now()));
  if (open.length >= MAX_PENDING) {
    throw new HttpError(429, 'TOO_MANY_PENDING', 'Kamu punya pesanan yang belum dibayar. Selesaikan atau batalkan dulu sebelum membuat yang baru.');
  }

  // Dihitung setelah validasi lolos, jadi salah ketik tidak menghabiskan jatah.
  await limit(`order:${auth.id}`, 10, 3600, 'Terlalu banyak pesanan dalam 1 jam. Coba lagi nanti.');

  const id = v.orderId();
  const price = s.price; // harga dikunci saat pesanan dibuat
  const pay = await jayapay.create({ amount: price, reference: id });
  const o = {
    id,
    uid: auth.id,
    email: auth.user.email,
    status: 'pending',
    build: 'none',
    price,
    app: { name, url, color, package: pkg, has_icon: !!icon },
    pay: { id: pay.id, total: pay.total ?? price, fee: pay.fee, fee_by: pay.fee_by, net: pay.net, qr_url: pay.qr_url, pay_url: pay.pay_url, expiry_at: pay.expiry_at },
    created: Date.now(),
    attempts: 0
  };
  await orders.create(o, icon && icon.dataUrl);
  return flow.view(o);
});
