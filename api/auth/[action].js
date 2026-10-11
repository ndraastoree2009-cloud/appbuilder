// /api/auth/register | login | admin | me
const crypto = require('crypto');
const { route, dispatch, HttpError, ip, sha, limit, strikes } = require('../../lib/http');
const users = require('../../lib/users');
const session = require('../../lib/session');

const DAY = 24 * 3600 * 1000;
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = dispatch(
  {
    register: route(
      'POST',
      async ({ req, body }) => {
        await limit(`reg:${sha(ip(req))}`, 5, 3600, 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.');
        const u = await users.create(body);
        const s = session.issue({ r: 'user', u: u.id }, 30 * DAY);
        return { ...s, user: users.publicView(u) };
      },
      { auth: 'none' }
    ),

    login: route(
      'POST',
      async ({ req, body }) => {
        const bucket = `login:${sha(ip(req))}`;
        await strikes.check(bucket, 10);
        const u = await users.authenticate(body.email, body.password);
        if (!u) {
          await strikes.hit(bucket, 900);
          await sleep(400);
          throw new HttpError(401, 'UNAUTHORIZED', 'Email atau password salah.');
        }
        if (u.disabled) throw new HttpError(403, 'ACCOUNT_DISABLED', 'Akun ini dinonaktifkan. Hubungi admin.');
        await strikes.clear(bucket);
        return { ...session.issue({ r: 'user', u: u.id }, 30 * DAY), user: users.publicView(u) };
      },
      { auth: 'none' }
    ),

    admin: route(
      'POST',
      async ({ req, body }) => {
        const U = process.env.ADMIN_USERNAME;
        const P = process.env.ADMIN_PASSWORD;
        if (!U || !P) throw new HttpError(503, 'LOGIN_DISABLED', 'Login admin belum diaktifkan. Isi ADMIN_USERNAME dan ADMIN_PASSWORD di environment Vercel.');
        const bucket = `admin:${sha(ip(req))}`;
        await strikes.check(bucket, 5);
        const ok = same(body.username ?? '', U) & same(body.password ?? '', P); // evaluasi keduanya agar waktu tetap
        if (!ok) {
          await strikes.hit(bucket, 900);
          await sleep(600);
          throw new HttpError(401, 'UNAUTHORIZED', 'Nama atau password admin salah.');
        }
        await strikes.clear(bucket);
        return { ...session.issue({ r: 'admin', n: U }, 12 * 3600 * 1000), label: U };
      },
      { auth: 'none' }
    ),

    me: route('GET', ({ auth }) => ({ role: auth.role, label: auth.label, user: auth.user ? users.publicView(auth.user) : null }), { auth: 'any' })
  },
  'action'
);
