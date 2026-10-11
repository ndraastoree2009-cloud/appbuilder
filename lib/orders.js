/** Penyimpanan pesanan di Redis. */
const store = require('./store');

const K = {
  order: (id) => `w2a:order:${id}`,
  all: 'w2a:orders',
  mine: (uid) => `w2a:uorders:${uid}`,
  icon: (id) => `w2a:icon:${id}`,
  stats: 'w2a:stats'
};
const ID_RE = /^[0-9A-F]{16}$/;

async function get(id) {
  if (!ID_RE.test(String(id))) return null;
  const r = await store.cmd('GET', K.order(id));
  return r ? JSON.parse(r) : null;
}

const save = (o) => store.cmd('SET', K.order(o.id), JSON.stringify(o));

async function create(o, iconDataUrl) {
  const cmds = [
    ['SET', K.order(o.id), JSON.stringify(o)],
    ['ZADD', K.all, String(o.created), o.id],
    ['ZADD', K.mine(o.uid), String(o.created), o.id],
    ['HINCRBY', K.stats, 'orders', '1']
  ];
  if (iconDataUrl) cmds.push(['SET', K.icon(o.id), iconDataUrl]);
  await store.pipeline(cmds);
}

async function many(ids) {
  if (!ids || !ids.length) return [];
  const rows = await store.cmd('MGET', ...ids.map(K.order));
  return rows.filter(Boolean).map((r) => JSON.parse(r));
}

const listMine = async (uid, offset, limit) => many(await store.cmd('ZREVRANGE', K.mine(uid), offset, offset + limit - 1));
const listAll = async (offset, limit) => many(await store.cmd('ZREVRANGE', K.all, offset, offset + limit - 1));
const countMine = async (uid) => Number(await store.cmd('ZCARD', K.mine(uid))) || 0;
const countAll = async () => Number(await store.cmd('ZCARD', K.all)) || 0;
const icon = (id) => store.cmd('GET', K.icon(id));
const stat = (field, by = 1) => store.cmd('HINCRBY', K.stats, field, String(by)).catch(() => {});
const stats = async () => store.pairs(await store.cmd('HGETALL', K.stats));

module.exports = { get, save, create, listMine, listAll, countMine, countAll, icon, stat, stats, K };
