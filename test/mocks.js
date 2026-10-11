// Mock bersama untuk tes dan server uji tampilan: env, jam, Redis, JayaPay, GitHub.
process.env.SESSION_SECRET = 'rahasia-sesi-panjang-sekali';
process.env.ADMIN_USERNAME = 'bos';
process.env.ADMIN_PASSWORD = 'rahasia-admin-123';
process.env.JAYAPAY_API_KEY = 'jp-key';
process.env.GH_REPO = 'me/builder';
process.env.GH_TOKEN = 'gh-token';
process.env.BUILD_SECRET = 'build-secret-panjang-1234';
process.env.SITE_URL = 'https://site.test';
process.env.KV_REST_API_URL = 'https://redis.test';
process.env.KV_REST_API_TOKEN = 'rt';

// ---- jam yang bisa dimajukan ----
let skew = 0;
const realNow = Date.now;
Date.now = () => realNow() + skew;
const advance = (ms) => { skew += ms; };
const rewind = (ms) => { skew -= ms; };

// ---- Redis palsu ----
const db = { s: {}, h: {}, z: {} };
function redis(args) {
  const [c, k, ...a] = args;
  const C = c.toUpperCase();
  const Z = () => (db.z[k] ||= []);
  if (C === 'GET') return db.s[k] ?? null;
  if (C === 'SET') { if (a.includes('NX') && k in db.s) return null; db.s[k] = a[0]; return 'OK'; }
  if (C === 'DEL') { const had = k in db.s; delete db.s[k]; return had ? 1 : 0; }
  if (C === 'INCR') { db.s[k] = String(Number(db.s[k] || 0) + 1); return Number(db.s[k]); }
  if (C === 'EXPIRE') return 1;
  if (C === 'MGET') return [k, ...a].map((x) => db.s[x] ?? null);
  if (C === 'HINCRBY') { const h = (db.h[k] ||= {}); h[a[0]] = String(Number(h[a[0]] || 0) + Number(a[1])); return Number(h[a[0]]); }
  if (C === 'HGETALL') return Object.entries(db.h[k] || {}).flat();
  if (C === 'ZADD') { Z().push({ score: Number(a[0]), m: a[1] }); return 1; }
  if (C === 'ZCARD') return Z().length;
  if (C === 'ZREVRANGE') return [...Z()].sort((x, y) => y.score - x.score).map((x) => x.m).slice(Number(a[0]), Number(a[1]) + 1);
  throw new Error('perintah redis tidak dikenal: ' + C);
}
const resetRL = () => Object.keys(db.s).filter((x) => x.startsWith('w2a:rl:')).forEach((x) => delete db.s[x]);

// ---- JayaPay & GitHub palsu ----
const jp = { created: [], status: 'pending', amount: null, cancelled: [], fail: false };
const gh = { dispatches: [], dispatchStatus: 204, released: new Set() };
global.fetch = async (url, opt = {}) => {
  const j = (o, s = 200, h = {}) => ({ ok: s < 400, status: s, headers: { get: (n) => h[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(o), json: async () => o });
  if (url.startsWith('https://redis.test')) {
    const b = JSON.parse(opt.body);
    return url.endsWith('/pipeline') ? j(b.map((c) => ({ result: redis(c) }))) : j({ result: redis(b) });
  }
  const body = opt.body ? JSON.parse(opt.body) : {};
  if (url.startsWith('https://jaya-pay.vercel.app/api/pay/create')) {
    if (jp.fail) return j({ error: 'channel nonaktif' }, 400);
    jp.created.push({ headers: opt.headers, body });
    const id = 'JP' + jp.created.length;
    return j({ id, reference: body.reference, amount: body.amount, fee: 100, fee_by: 'buyer', total: body.amount + 100, net: body.amount, status: 'pending', pay_url: `https://jaya-pay.vercel.app/pay/${id}`, qr_url: `https://jaya-pay.vercel.app/pay/${id}/qr`, expiry: '2026-10-11 20:00:00', createdAt: '2026-10-11T12:45:00.000Z' });
  }
  if (url.startsWith('https://jaya-pay.vercel.app/api/pay/status')) {
    const id = new URL(url).searchParams.get('id');
    const o = jp.created[Number(id.slice(2)) - 1];
    return j({ id, reference: o.body.reference, amount: jp.amount ?? o.body.amount, fee: 100, net: o.body.amount, status: jp.status });
  }
  if (url.startsWith('https://jaya-pay.vercel.app/api/pay/cancel')) { jp.cancelled.push(body.id); return j({ id: body.id, status: 'cancel' }); }
  if (url.includes('/actions/workflows/')) {
    if (gh.dispatchStatus === 204) gh.dispatches.push({ url, headers: opt.headers, body });
    return { ok: gh.dispatchStatus === 204, status: gh.dispatchStatus, text: async () => 'boom', headers: { get: () => null } };
  }
  const rel = /\/releases\/tags\/order-([0-9A-F]+)$/.exec(url);
  if (rel) return gh.released.has(rel[1]) ? j({ assets: [{ id: 1, name: 'toko.apk', size: 1500000, state: 'uploaded', url: 'https://api.github.com/assets/1' }] }) : j({ message: 'Not Found' }, 404);
  if (url === 'https://api.github.com/assets/1') return j({}, 302, { location: 'https://objects.test/signed-apk' });
  return j({}, 404);
};


module.exports = { db, jp, gh, resetRL, advance, rewind };
