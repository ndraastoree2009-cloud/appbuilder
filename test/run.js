// Tes tanpa jaringan: Redis, JayaPay, dan GitHub di-mock lewat fetch.
const assert = require('assert');
const { db, jp, gh, resetRL, advance, rewind } = require('./mocks');

// ---- helper memanggil handler ----
function call(handler, o = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: o.method || 'GET', headers: { host: 'site.test', 'x-forwarded-for': o.ip || '1.2.3.4', ...(o.headers || {}) }, query: o.query || {}, body: o.body };
    const res = {
      statusCode: 200,
      setHeader: (k, v) => (headers[k.toLowerCase()] = v),
      status(c) { this.statusCode = c; return this; },
      json(j) { resolve({ code: this.statusCode, json: j, headers }); return this; },
      end(b) { resolve({ code: this.statusCode, raw: b, headers }); return this; }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
const H = {
  public: require('../api/public'), logo: require('../api/logo'), icon: require('../api/icon'), build: require('../api/build'),
  order: require('../api/order'), orders: require('../api/orders'), auth: require('../api/auth/[action]'), admin: require('../api/admin/[action]')
};
const bearer = (t) => ({ authorization: 'Bearer ' + t });
const auth = (a, o) => call(H.auth, { ...o, query: { action: a, ...(o && o.query) } });
const admin = (a, t, o = {}) => call(H.admin, { ...o, query: { action: a, ...o.query }, headers: bearer(t) });
const ok = (r, m) => assert.strictEqual(r.code, 200, `${m || ''} -> ${JSON.stringify(r.json)}`);
const code = (r) => r.json && r.json.error && r.json.error.code;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  // ===== halaman depan =====
  let r = await call(H.public);
  ok(r);
  assert.strictEqual(r.json.data.site_name, 'Web2APK');
  assert.strictEqual(r.json.data.price, 25000);
  assert.strictEqual(r.json.data.ready, true);
  assert.ok(!('logo' in r.json.data), 'logo mentah tidak ikut dikirim');
  assert.strictEqual((await call(H.public, { method: 'POST' })).code, 405);

  // ===== akun user =====
  assert.strictEqual(code(await auth('register', { method: 'POST', body: { name: 'Budi', email: 'bukan-email', password: 'passw0rd!' } })), 'VALIDATION');
  assert.strictEqual(code(await auth('register', { method: 'POST', body: { name: 'Budi', email: 'budi@mail.test', password: 'pendek' } })), 'VALIDATION');
  r = await auth('register', { method: 'POST', body: { name: 'Budi', email: 'Budi@Mail.test', password: 'passw0rd!' } });
  ok(r, 'daftar');
  const T1 = r.json.data.token;
  assert.strictEqual(r.json.data.user.email, 'budi@mail.test');
  assert.ok(!JSON.stringify(r.json).includes('s1$'), 'hash password tidak bocor');
  assert.strictEqual(code(await auth('register', { method: 'POST', body: { name: 'Budi 2', email: 'budi@mail.test', password: 'passw0rd!' } })), 'EMAIL_TAKEN');
  r = await auth('register', { method: 'POST', body: { name: 'Sari', email: 'sari@mail.test', password: 'passw0rd!' } });
  const T2 = r.json.data.token;
  const U2 = r.json.data.user.id;

  assert.strictEqual(code(await auth('login', { method: 'POST', body: { email: 'budi@mail.test', password: 'salah-salah' } })), 'UNAUTHORIZED');
  assert.strictEqual(code(await auth('login', { method: 'POST', body: { email: 'tidak@ada.test', password: 'salah-salah' } })), 'UNAUTHORIZED');
  r = await auth('login', { method: 'POST', body: { email: 'budi@mail.test', password: 'passw0rd!' } });
  ok(r, 'login');
  r = await auth('me', { headers: bearer(T1) });
  assert.strictEqual(r.json.data.role, 'user');
  assert.strictEqual(r.json.data.user.name, 'Budi');
  assert.strictEqual((await auth('me')).code, 401);
  assert.strictEqual((await auth('me', { headers: bearer(T1.slice(0, -3) + 'abc') })).code, 401, 'tanda tangan rusak');
  assert.strictEqual((await auth('nama-ngawur', { method: 'POST' })).code, 404);

  // pembatas login: 10 gagal dari satu IP
  resetRL();
  for (let i = 0; i < 10; i++) await auth('login', { method: 'POST', ip: '9.9.9.9', body: { email: 'budi@mail.test', password: 'salah-salah' } });
  assert.strictEqual(code(await auth('login', { method: 'POST', ip: '9.9.9.9', body: { email: 'budi@mail.test', password: 'passw0rd!' } })), 'TOO_MANY_ATTEMPTS');
  resetRL();

  // ===== admin =====
  assert.strictEqual(code(await auth('admin', { method: 'POST', body: { username: 'bos', password: 'salah' } })), 'UNAUTHORIZED');
  r = await auth('admin', { method: 'POST', body: { username: 'bos', password: 'rahasia-admin-123' } });
  ok(r, 'login admin');
  const TA = r.json.data.token;
  assert.strictEqual((await call(H.orders, { headers: bearer(TA) })).code, 403, 'admin bukan user');
  assert.strictEqual((await admin('stats', T1)).code, 403, 'user tidak boleh ke endpoint admin');
  assert.strictEqual((await call(H.admin, { query: { action: 'stats' } })).code, 401);

  // pengaturan situs
  r = await admin('settings', TA, { method: 'PUT', body: { price: 500 } });
  assert.strictEqual(code(r), 'VALIDATION');
  assert.strictEqual(code(await admin('settings', TA, { method: 'PUT', body: { brand_color: 'merah' } })), 'VALIDATION');
  assert.strictEqual(code(await admin('settings', TA, { method: 'PUT', body: { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } })), 'VALIDATION', 'SVG ditolak');
  assert.strictEqual(code(await admin('settings', TA, { method: 'PUT', body: { logo: 'data:image/png;base64,AAAA' } })), 'VALIDATION', 'bukan PNG sungguhan');
  r = await admin('settings', TA, { method: 'PUT', body: { site_name: 'Apkin Aja', tagline: 'Web jadi aplikasi', price: '30000', brand_color: '#E8542C', contact: 'WA 0812', logo: PNG } });
  ok(r, 'simpan pengaturan');
  assert.strictEqual(r.json.data.price, 30000);
  assert.strictEqual(r.json.data.brand_color, '#e8542c');
  r = await call(H.public);
  assert.strictEqual(r.json.data.site_name, 'Apkin Aja');
  assert.ok(/\/api\/logo\?v=\d{10,}/.test(r.json.data.logo_url));
  r = await call(H.logo);
  assert.strictEqual(r.headers['content-type'], 'image/png');
  assert.strictEqual(r.raw.subarray(1, 4).toString(), 'PNG');
  await admin('settings', TA, { method: 'PUT', body: { remove_logo: true } });
  r = await call(H.logo);
  assert.strictEqual(r.headers['content-type'], 'image/svg+xml', 'kembali ke logo bawaan');
  assert.strictEqual((await admin('settings', T1)).code, 403);

  // ===== validasi pesanan =====
  const mk = (b, t = T1) => call(H.orders, { method: 'POST', headers: bearer(t), body: { app_name: 'Toko Saya', app_url: 'https://tokosaya.com', ...b } });
  assert.strictEqual((await call(H.orders, { method: 'POST', body: {} })).code, 401);
  for (const [b, why] of [
    [{ app_url: 'http://tokosaya.com' }, 'http ditolak'],
    [{ app_url: 'https://localhost' }, 'localhost'],
    [{ app_url: 'https://192.168.1.5/x' }, 'IP privat'],
    [{ app_url: 'https://user:pw@tokosaya.com' }, 'kredensial di URL'],
    [{ app_url: 'tokosaya' }, 'tanpa titik'],
    [{ app_name: 'A' }, 'nama terlalu pendek'],
    [{ app_name: '<script>x</script>' }, 'nama berisi tag'],
    [{ color: 'merah' }, 'warna'],
    [{ package: 'com.android.evil' }, 'package terlarang'],
    [{ package: 'Bukan.Valid' }, 'package huruf besar'],
    [{ icon: 'data:image/png;base64,AAAA' }, 'ikon palsu']
  ]) assert.strictEqual(code(await mk(b)), 'VALIDATION', why);
  assert.strictEqual(jp.created.length, 0, 'validasi gagal tidak boleh menyentuh JayaPay');

  // ===== buat pesanan + QRIS Fast =====
  jp.fail = true;
  assert.strictEqual(code(await mk({})), 'PAYMENT_ERROR');
  jp.fail = false;
  r = await mk({ app_url: 'tokosaya.com', color: '#1A9E6F', icon: PNG });
  ok(r, 'buat pesanan');
  const O1 = r.json.data;
  assert.ok(/^[0-9A-F]{16}$/.test(O1.id));
  assert.strictEqual(O1.status, 'pending');
  assert.strictEqual(O1.price, 30000);
  assert.strictEqual(O1.app.url, 'https://tokosaya.com/', 'https ditambahkan otomatis');
  assert.strictEqual(O1.app.package, 'app.w2a.tokosayacom');
  assert.strictEqual(O1.app.color, '#1a9e6f');
  assert.strictEqual(O1.pay.total, 30100);
  assert.strictEqual(O1.pay.qr_url, 'https://jaya-pay.vercel.app/pay/JP1/qr');
  assert.strictEqual(O1.pay.expiry_at, Date.parse('2026-10-11T20:00:00+07:00'), 'expiry dibaca sebagai WIB');
  assert.ok(!('pay_id' in O1) && !('email' in O1), 'data internal tidak bocor ke user');
  const sent = jp.created[0];
  assert.strictEqual(sent.headers['x-api-key'], 'jp-key');
  assert.deepStrictEqual(sent.body, { amount: 30000, channel: 'qrisfast', reference: O1.id });

  // harga dikunci saat pesanan dibuat
  await admin('settings', TA, { method: 'PUT', body: { price: 45000 } });
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(T1) });
  ok(r);
  assert.strictEqual(r.json.data.price, 30000);
  assert.strictEqual(r.json.data.status, 'pending');
  assert.strictEqual(gh.dispatches.length, 0, 'belum bayar, belum build');

  // akses antar pengguna
  assert.strictEqual((await call(H.order, { query: { id: O1.id }, headers: bearer(T2) })).code, 404);
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(TA) });
  assert.strictEqual(r.json.data.email, 'budi@mail.test');
  assert.strictEqual(r.json.data.pay_id, 'JP1');
  assert.strictEqual((await call(H.order, { query: { id: 'bukan-id' }, headers: bearer(T1) })).code, 404);

  // ===== pelunasan: dua polling bersamaan hanya memicu satu build =====
  jp.status = 'settlement';
  advance(10000);
  const both = await Promise.all([call(H.order, { query: { id: O1.id }, headers: bearer(T1) }), call(H.order, { query: { id: O1.id }, headers: bearer(T1) })]);
  both.forEach((x) => ok(x));
  assert.strictEqual(gh.dispatches.length, 1, 'tepat satu build dipicu');
  const d = gh.dispatches[0];
  assert.ok(d.url.endsWith('/repos/me/builder/actions/workflows/build-apk.yml/dispatches'));
  assert.strictEqual(d.headers.authorization, 'Bearer gh-token');
  assert.strictEqual(d.body.ref, 'main');
  assert.deepStrictEqual(Object.keys(d.body.inputs).sort(), ['app_name', 'app_url', 'icon_url', 'order_id', 'package_name', 'theme_color']);
  assert.strictEqual(d.body.inputs.order_id, O1.id);
  assert.strictEqual(d.body.inputs.theme_color, '#1a9e6f');
  assert.ok(d.body.inputs.icon_url.startsWith(`https://site.test/api/icon?id=${O1.id}&t=`));
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.status, 'paid');
  assert.strictEqual(r.json.data.build, 'queued');
  assert.strictEqual(gh.dispatches.length, 1, 'polling lanjutan tidak memicu build lagi');
  assert.deepStrictEqual({ paid: db.h['w2a:stats'].paid, revenue: db.h['w2a:stats'].revenue }, { paid: '1', revenue: '30000' });

  // ikon untuk runner: hanya lewat tautan bertanda
  const iconUrl = new URL(d.body.inputs.icon_url);
  r = await call(H.icon, { query: Object.fromEntries(iconUrl.searchParams) });
  assert.strictEqual(r.headers['content-type'], 'image/png');
  assert.strictEqual((await call(H.icon, { query: { id: O1.id, t: '1234567890123.abc' } })).code, 403);
  assert.strictEqual((await call(H.icon, { query: { id: 'A'.repeat(16), t: iconUrl.searchParams.get('t') } })).code, 403, 'token terikat ke id');

  // ===== callback build =====
  const cb = (b, secret = 'build-secret-panjang-1234') => call(H.build, { method: 'POST', headers: { 'x-build-secret': secret }, body: b });
  assert.strictEqual((await cb({ order_id: O1.id, status: 'building' }, 'salah')).code, 401);
  assert.strictEqual((await call(H.build, { method: 'POST', body: { order_id: O1.id } })).code, 401);
  assert.strictEqual((await cb({ order_id: 'F'.repeat(16), status: 'building' })).code, 404);
  ok(await cb({ order_id: O1.id, status: 'building', run_url: 'https://github.com/me/builder/actions/runs/1' }));
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.build, 'building');
  assert.ok(!('run_url' in r.json.data), 'run_url hanya untuk admin');

  assert.strictEqual(code(await cb({ order_id: O1.id, status: 'done' })), 'NO_ASSET', 'done tanpa APK ditolak');
  ok(await cb({ order_id: O1.id, status: 'failed', message: 'gradle error: xyz' }));
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.build, 'failed');
  assert.ok(!JSON.stringify(r.json).includes('gradle error'), 'detail teknis tidak tampil ke user');
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(TA) });
  assert.strictEqual(r.json.data.build_error_detail, 'gradle error: xyz');

  // retry: user dibatasi 3 percobaan, admin tidak
  const retry = (t) => call(H.order, { method: 'POST', headers: bearer(t), body: { id: O1.id, action: 'retry' } });
  r = await retry(T1);
  ok(r, 'retry 1');
  assert.strictEqual(r.json.data.build, 'queued');
  assert.strictEqual(gh.dispatches.length, 2);
  await cb({ order_id: O1.id, status: 'failed' });
  ok(await retry(T1), 'retry 2');
  await cb({ order_id: O1.id, status: 'failed' });
  assert.strictEqual(code(await retry(T1)), 'RETRY_LIMIT');
  ok(await retry(TA), 'admin tidak dibatasi');
  assert.strictEqual(gh.dispatches.length, 4);
  assert.strictEqual(code(await retry(TA)), 'NOT_RETRYABLE', 'tidak bisa retry saat sedang antre');
  assert.strictEqual(code(await call(H.order, { method: 'POST', headers: bearer(T1), body: { id: O1.id, action: 'hapus' } })), 'VALIDATION');

  // build selesai: terdeteksi lewat release walau callback tidak datang
  gh.released.add(O1.id);
  advance(6000);
  r = await call(H.order, { query: { id: O1.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.build, 'done');
  assert.deepStrictEqual(r.json.data.apk, { name: 'toko.apk', size: 1500000 });
  assert.ok(r.json.data.download_url.startsWith(`/api/order?id=${O1.id}&download=1&t=`));

  // unduh: redirect ke tautan GitHub bertanda, tautan unduhan terikat ke pesanan
  const dl = new URL('https://site.test' + r.json.data.download_url);
  r = await call(H.order, { query: Object.fromEntries(dl.searchParams) });
  assert.strictEqual(r.code, 302);
  assert.strictEqual(r.headers.location, 'https://objects.test/signed-apk');
  assert.strictEqual((await call(H.order, { query: { id: O1.id, download: '1', t: '1234567890123.abc' } })).code, 403);
  assert.strictEqual((await call(H.order, { query: { id: O1.id, download: '1' } })).code, 403, 'tanpa token tidak bisa unduh');
  advance(11 * 60 * 1000);
  assert.strictEqual((await call(H.order, { query: Object.fromEntries(dl.searchParams) })).code, 403, 'tautan kedaluwarsa 10 menit');
  rewind(11 * 60 * 1000);

  // ===== kegagalan memicu build tidak menghilangkan pembayaran =====
  resetRL();
  r = await mk({ app_name: 'Warung Kopi' });
  ok(r);
  const O2 = r.json.data;
  jp.status = 'settlement';
  gh.dispatchStatus = 422;
  advance(10000);
  r = await call(H.order, { query: { id: O2.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.status, 'paid');
  assert.strictEqual(r.json.data.build, 'failed');
  assert.ok(/Pembayaranmu aman/.test(r.json.data.build_error));
  assert.ok(!JSON.stringify(r.json).includes('422'), 'detail GitHub tidak tampil ke user');
  gh.dispatchStatus = 204;
  r = await call(H.order, { method: 'POST', headers: bearer(T1), body: { id: O2.id, action: 'retry' } });
  assert.strictEqual(r.json.data.build, 'queued');

  // build menggantung > 30 menit dianggap gagal
  advance(31 * 60 * 1000);
  r = await call(H.order, { query: { id: O2.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.build, 'failed');
  assert.ok(/30 menit/.test(r.json.data.build_error));

  // ===== nominal tidak cocok -> review, admin yang memutuskan =====
  r = await mk({ app_name: 'Salah Bayar' });
  const O3 = r.json.data;
  jp.status = 'settlement';
  jp.amount = 1000;
  advance(10000);
  const before = gh.dispatches.length;
  r = await call(H.order, { query: { id: O3.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.status, 'review');
  assert.strictEqual(gh.dispatches.length, before, 'tidak build sebelum disetujui');
  jp.amount = null;
  r = await admin('orders', TA, { method: 'POST', body: { id: O3.id, action: 'approve' } });
  ok(r);
  assert.strictEqual(r.json.data.status, 'paid');
  assert.strictEqual(gh.dispatches.length, before + 1);
  assert.strictEqual(code(await admin('orders', TA, { method: 'POST', body: { id: O3.id, action: 'approve' } })), 'NOT_REVIEW');

  // ===== kedaluwarsa, pembatalan, batas pesanan menggantung =====
  r = await mk({ app_name: 'Telat Bayar' });
  const O4 = r.json.data;
  jp.status = 'expire';
  advance(10000);
  r = await call(H.order, { query: { id: O4.id }, headers: bearer(T1) });
  assert.strictEqual(r.json.data.status, 'expired');

  jp.status = 'pending';
  const open = [];
  for (let i = 0; i < 3; i++) { r = await mk({ app_name: 'Pending ' + i }); ok(r, 'pending ' + i); open.push(r.json.data.id); }
  assert.strictEqual(code(await mk({ app_name: 'Pending 4' })), 'TOO_MANY_PENDING');
  const cancelled = jp.cancelled.length;
  r = await call(H.order, { method: 'POST', headers: bearer(T1), body: { id: open[0], action: 'cancel' } });
  assert.strictEqual(r.json.data.status, 'cancelled');
  assert.strictEqual(jp.cancelled.length, cancelled + 1);
  ok(await mk({ app_name: 'Pending 5' }), 'slot kosong setelah dibatalkan');
  assert.strictEqual(code(await call(H.order, { method: 'POST', headers: bearer(T1), body: { id: O1.id, action: 'cancel' } })), 'NOT_PENDING');

  // ===== daftar pesanan =====
  r = await call(H.orders, { headers: bearer(T1) });
  ok(r);
  assert.ok(r.json.data.total >= 8);
  assert.ok(r.json.data.items.every((o) => !('email' in o)));
  assert.strictEqual((await call(H.orders, { headers: bearer(T2) })).json.data.total, 0, 'pesanan user lain tidak terlihat');

  // ===== admin: daftar, filter, pengguna, statistik =====
  r = await admin('orders', TA);
  ok(r);
  assert.ok(r.json.data.items[0].email && r.json.data.total >= 8);
  r = await admin('orders', TA, { query: { status: 'review' } });
  assert.strictEqual(r.json.data.items.length, 0);
  r = await admin('orders', TA, { query: { status: 'done' } });
  assert.deepStrictEqual(r.json.data.items.map((o) => o.id), [O1.id]);
  r = await admin('orders', TA, { query: { q: 'warung' } });
  assert.strictEqual(r.json.data.items.length, 1);
  assert.strictEqual(code(await admin('orders', TA, { method: 'POST', body: { id: O1.id, action: 'ngawur' } })), 'VALIDATION');

  r = await admin('users', TA);
  assert.strictEqual(r.json.data.total, 2);
  assert.ok(r.json.data.items.every((u) => !('pass' in u)));
  r = await admin('stats', TA);
  assert.deepStrictEqual({ users: r.json.data.users, paid: r.json.data.paid }, { users: 2, paid: 3 });
  assert.ok(r.json.data.builds_done >= 1 && r.json.data.builds_failed >= 2);

  // ===== nonaktifkan pengguna =====
  r = await admin('users', TA, { method: 'PATCH', body: { id: U2, disabled: true } });
  assert.strictEqual(r.json.data.disabled, true);
  assert.strictEqual(code(await auth('me', { headers: bearer(T2) })), 'ACCOUNT_DISABLED');
  assert.strictEqual(code(await auth('login', { method: 'POST', body: { email: 'sari@mail.test', password: 'passw0rd!' } })), 'ACCOUNT_DISABLED');
  await admin('users', TA, { method: 'PATCH', body: { id: U2, disabled: false } });
  ok(await auth('me', { headers: bearer(T2) }));

  // ===== sesi admin dicabut bila password admin diganti =====
  process.env.ADMIN_PASSWORD = 'password-baru-456';
  assert.strictEqual((await admin('stats', TA)).code, 401);
  assert.strictEqual((await auth('me', { headers: bearer(T1) })).code, 200, 'sesi user tidak ikut dicabut');
  process.env.ADMIN_PASSWORD = 'rahasia-admin-123';

  // ===== tanpa Redis =====
  delete process.env.KV_REST_API_URL;
  r = await call(H.public);
  ok(r);
  assert.strictEqual(r.json.data.ready, false);
  assert.strictEqual(code(await auth('login', { method: 'POST', body: {} })), 'STORE_MISSING');

  console.log('Semua tes lulus');
})().catch((e) => {
  console.error('GAGAL:', e.message);
  process.exit(1);
});
