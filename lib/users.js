/** Akun pengguna: email + password (scrypt), disimpan di Redis. */
const crypto = require('crypto');
const { promisify } = require('util');
const { HttpError } = require('./errors');
const store = require('./store');
const v = require('./validate');

const scrypt = promisify(crypto.scrypt);
const K = { user: (id) => `w2a:user:${id}`, email: (e) => `w2a:email:${e}`, all: 'w2a:users' };
const ID_RE = /^u[0-9a-f]{12}$/;

async function hash(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 32);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}

async function check(pw, stored) {
  const [tag, salt, h] = String(stored || '').split('$');
  if (tag !== 's1' || !salt || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got);
}

let dummy;
/** Verifikasi tetap dijalankan untuk email yang tidak ada, agar waktu respons tidak membocorkan keberadaan akun. */
async function burn(pw) {
  dummy ||= await hash('dummy-password');
  await check(pw, dummy);
}

const publicView = (u) => ({ id: u.id, name: u.name, email: u.email, created: u.created, disabled: !!u.disabled });

async function get(id) {
  if (!ID_RE.test(String(id))) return null;
  const r = await store.cmd('GET', K.user(id));
  return r ? JSON.parse(r) : null;
}

async function create(body) {
  const email = String(body.email ?? '').trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw v.bad('Email tidak valid.');
  const name = v.clean(body.name, 50);
  if (name.length < 2) throw v.bad('Nama minimal 2 karakter.');
  const pw = String(body.password ?? '');
  if (pw.length < 8 || pw.length > 100) throw v.bad('Password 8 sampai 100 karakter.');

  const id = 'u' + crypto.randomBytes(6).toString('hex');
  const ok = await store.cmd('SET', K.email(email), id, 'NX');
  if (!ok) throw new HttpError(409, 'EMAIL_TAKEN', 'Email ini sudah terdaftar. Silakan masuk.');
  const rec = { id, name, email, pass: await hash(pw), created: Date.now(), disabled: false };
  await store.pipeline([
    ['SET', K.user(id), JSON.stringify(rec)],
    ['ZADD', K.all, String(rec.created), id]
  ]);
  return rec;
}

/** Mengembalikan user bila email + password cocok, selain itu null. */
async function authenticate(emailRaw, pw) {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  const id = email ? await store.cmd('GET', K.email(email)) : null;
  const u = id ? await get(id) : null;
  if (!u) {
    await burn(String(pw ?? ''));
    return null;
  }
  return (await check(String(pw ?? ''), u.pass)) ? u : null;
}

async function setDisabled(id, disabled) {
  const u = await get(id);
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'Pengguna tidak ditemukan.');
  u.disabled = !!disabled;
  await store.cmd('SET', K.user(id), JSON.stringify(u));
  return u;
}

async function list(offset, limit) {
  const ids = await store.cmd('ZREVRANGE', K.all, offset, offset + limit - 1);
  if (!ids || !ids.length) return [];
  const rows = await store.cmd('MGET', ...ids.map(K.user));
  return rows.filter(Boolean).map((r) => publicView(JSON.parse(r)));
}

const count = async () => Number(await store.cmd('ZCARD', K.all)) || 0;

module.exports = { create, get, authenticate, setDisabled, list, count, publicView };
