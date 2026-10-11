// Khusus admin: /api/admin/settings | orders | users | stats
const { route, dispatch, HttpError } = require('../../lib/http');
const settings = require('../../lib/settings');
const orders = require('../../lib/orders');
const users = require('../../lib/users');
const flow = require('../../lib/flow');

const PAGE = 20;
const SCAN = 500;
const A = { auth: 'admin' };

const matchStatus = (o, s) => (s === 'failed' ? o.build === 'failed' : s === 'done' ? o.build === 'done' : o.status === s);

module.exports = dispatch(
  {
    settings: route(
      ['GET', 'PUT'],
      async ({ method, body }) => {
        const s = method === 'PUT' ? await settings.update(body) : await settings.get();
        return { ...settings.publicView(s), min_price: settings.MIN_PRICE, max_price: settings.MAX_PRICE, has_logo: s.has_logo };
      },
      A
    ),

    orders: route(
      ['GET', 'POST'],
      async ({ method, query, body, base }) => {
        if (method === 'POST') {
          const o = await orders.get(String(body.id || ''));
          if (!o) throw new HttpError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.');
          let r;
          if (body.action === 'retry') r = await flow.retry(o, base, true);
          else if (body.action === 'cancel') r = await flow.cancel(o, base);
          else if (body.action === 'approve') r = await flow.approve(o, base);
          else if (body.action === 'refresh') r = await flow.refresh(o, base);
          else throw new HttpError(422, 'VALIDATION', 'action harus retry, cancel, approve, atau refresh.');
          return flow.view(r, { admin: true });
        }
        const page = Math.max(1, Number(query.page) || 1);
        const status = String(query.status || '');
        const q = String(query.q || '').trim().toLowerCase();
        if (!status && !q) {
          const [items, total] = await Promise.all([orders.listAll((page - 1) * PAGE, PAGE), orders.countAll()]);
          return { page, per_page: PAGE, total, items: items.map((o) => flow.view(o, { admin: true })) };
        }
        // Dengan filter: pindai SCAN pesanan terbaru lalu bagi per halaman di memori.
        const recent = await orders.listAll(0, SCAN);
        const hits = recent.filter(
          (o) =>
            (!status || matchStatus(o, status)) &&
            (!q || [o.id, o.email, o.app.name, o.app.url].some((x) => String(x).toLowerCase().includes(q)))
        );
        return {
          page,
          per_page: PAGE,
          total: hits.length,
          scanned: recent.length,
          items: hits.slice((page - 1) * PAGE, page * PAGE).map((o) => flow.view(o, { admin: true }))
        };
      },
      A
    ),

    users: route(
      ['GET', 'PATCH'],
      async ({ method, query, body }) => {
        if (method === 'PATCH') return users.publicView(await users.setDisabled(String(body.id || ''), !!body.disabled));
        const page = Math.max(1, Number(query.page) || 1);
        const [items, total] = await Promise.all([users.list((page - 1) * PAGE, PAGE), users.count()]);
        return { page, per_page: PAGE, total, items };
      },
      A
    ),

    stats: route(
      'GET',
      async () => {
        const [st, nu] = await Promise.all([orders.stats(), users.count()]);
        const n = (k) => Number(st[k]) || 0;
        return { users: nu, orders: n('orders'), paid: n('paid'), revenue: n('revenue'), builds_done: n('builds_done'), builds_failed: n('builds_failed') };
      },
      A
    )
  },
  'action'
);
