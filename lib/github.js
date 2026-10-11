/**
 * Pemicu build lewat GitHub Actions (workflow_dispatch) dan pengambilan APK dari GitHub Release.
 * Repo harus PRIVATE: APK hanya bisa diunduh lewat situs ini setelah pembayaran lunas.
 */
const { HttpError } = require('./errors');

const API = 'https://api.github.com';

function cfg() {
  const repo = process.env.GH_REPO;
  const token = process.env.GH_TOKEN;
  if (!repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new HttpError(503, 'BUILDER_MISSING', 'Layanan build belum disiapkan (GH_REPO / GH_TOKEN).');
  }
  return { repo, token, workflow: process.env.GH_WORKFLOW || 'build-apk.yml', ref: process.env.GH_REF || 'main' };
}

const headers = (token, accept = 'application/vnd.github+json') => ({
  accept,
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
  'user-agent': 'web2apk-site'
});

async function req(url, opt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await fetch(url, { ...opt, signal: ctrl.signal });
  } catch {
    throw new HttpError(504, 'BUILDER_UNREACHABLE', 'Gagal menghubungi GitHub.');
  } finally {
    clearTimeout(timer);
  }
}

async function dispatch(inputs) {
  const c = cfg();
  const r = await req(`${API}/repos/${c.repo}/actions/workflows/${encodeURIComponent(c.workflow)}/dispatches`, {
    method: 'POST',
    headers: { ...headers(c.token), 'content-type': 'application/json' },
    body: JSON.stringify({ ref: c.ref, inputs })
  });
  if (r.status !== 204) {
    const t = await r.text().catch(() => '');
    throw new HttpError(502, 'BUILDER_ERROR', `GitHub menolak permintaan build (HTTP ${r.status}).`, { upstream: t.slice(0, 300) });
  }
}

/** Aset APK dari release `order-<id>`, atau null bila belum ada. */
async function releaseAsset(id) {
  const c = cfg();
  const r = await req(`${API}/repos/${c.repo}/releases/tags/order-${encodeURIComponent(id)}`, { headers: headers(c.token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, 'BUILDER_ERROR', `GitHub gagal membaca release (HTTP ${r.status}).`);
  const j = await r.json();
  const a = (j.assets || []).find((x) => /\.apk$/i.test(x.name) && (!x.state || x.state === 'uploaded'));
  return a ? { id: a.id, name: a.name, size: a.size, url: a.url } : null;
}

/** URL unduhan bertanda tangan (berumur pendek) untuk aset di repo private. */
async function assetLocation(asset) {
  const c = cfg();
  const r = await req(asset.url, { headers: headers(c.token, 'application/octet-stream'), redirect: 'manual' });
  const loc = r.headers.get('location');
  if (!loc || r.status < 300 || r.status > 399) throw new HttpError(502, 'BUILDER_ERROR', 'GitHub tidak memberi tautan unduhan.');
  return loc;
}

module.exports = { dispatch, releaseAsset, assetLocation };
