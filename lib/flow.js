/**
 * Alur pesanan: bayar (JayaPay qrisfast) -> build (GitHub Actions) -> unduh.
 * Dipanggil setiap kali halaman pesanan melakukan polling, jadi semua langkah idempoten.
 */
const { HttpError } = require('./errors');
const store = require('./store');
const orders = require('./orders');
const jayapay = require('./jayapay');
const github = require('./github');
const session = require('./session');

const PAY_POLL_MS = 2500;
const BUILD_POLL_MS = 5000;
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_USER_RETRIES = 3;

const safe = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    console.error('flow:', e.code || e.message);
    return null;
  }
};

async function startBuild(o, base) {
  const inputs = {
    order_id: o.id,
    app_name: o.app.name,
    app_url: o.app.url,
    package_name: o.app.package,
    theme_color: o.app.color,
    icon_url: o.app.has_icon ? `${base}/api/icon?id=${o.id}&t=${session.link('icon', o.id, 2 * 3600 * 1000)}` : ''
  };
  o.attempts = (o.attempts || 0) + 1;
  o.build_started_at = Date.now();
  o.build_error = null;
  o.build_error_detail = null;
  try {
    await github.dispatch(inputs);
    o.build = 'queued';
  } catch (e) {
    o.build = 'failed';
    o.build_error = 'Build belum bisa dimulai. Pembayaranmu aman, coba build ulang beberapa saat lagi.';
    o.build_error_detail = `${e.code}: ${e.message} ${JSON.stringify(e.details || {})}`.slice(0, 500);
  }
  await orders.save(o);
  return o;
}

async function onSettlement(o, st, base) {
  if ((st.amount != null && st.amount !== o.price) || (st.reference && st.reference !== o.id)) {
    o.status = 'review';
    o.note = `Nominal/referensi pembayaran tidak cocok (dibayar ${st.amount}, seharusnya ${o.price}).`;
    await orders.save(o);
    return o;
  }
  // Hanya satu permintaan yang boleh memproses pelunasan, walau banyak polling bersamaan.
  const first = await store.cmd('SET', `w2a:paid:${o.id}`, '1', 'NX');
  if (!first) return (await orders.get(o.id)) || o;
  o.status = 'paid';
  o.paid_at = Date.now();
  o.pay.fee = st.fee ?? o.pay.fee;
  o.pay.net = st.net ?? o.pay.net;
  await orders.save(o);
  await orders.stat('paid');
  await orders.stat('revenue', o.price);
  return startBuild(o, base);
}

async function checkPayment(o, base) {
  if (Date.now() - (o.pay_checked_at || 0) < PAY_POLL_MS) return o;
  o.pay_checked_at = Date.now();
  const st = await safe(() => jayapay.status(o.pay.id));
  if (!st) return o;
  if (st.status === 'settlement') return onSettlement(o, st, base);
  if (st.status === 'expire' || st.status === 'expired') o.status = 'expired';
  else if (st.status === 'cancel' || st.status === 'cancelled') o.status = 'cancelled';
  await orders.save(o);
  return o;
}

async function checkBuild(o) {
  if (Date.now() - (o.build_checked_at || 0) < BUILD_POLL_MS) return o;
  o.build_checked_at = Date.now();
  const asset = await safe(() => github.releaseAsset(o.id));
  if (asset) {
    o.build = 'done';
    o.build_done_at = Date.now();
    o.apk = { name: asset.name, size: asset.size };
    await orders.stat('builds_done');
  } else if (Date.now() - (o.build_started_at || 0) > BUILD_TIMEOUT_MS) {
    o.build = 'failed';
    o.build_error = 'Build melebihi batas waktu 30 menit. Coba build ulang.';
    await orders.stat('builds_failed');
  }
  await orders.save(o);
  return o;
}

/** Perbarui status pesanan dari JayaPay / GitHub, lalu kembalikan versi terbaru. */
async function refresh(o, base) {
  if (o.status === 'pending') return checkPayment(o, base);
  if (o.status === 'paid' && (o.build === 'queued' || o.build === 'building')) return checkBuild(o);
  return o;
}

async function cancel(o, base) {
  if (o.status !== 'pending') throw new HttpError(409, 'NOT_PENDING', 'Hanya pesanan yang belum dibayar yang bisa dibatalkan.');
  const st = await safe(() => jayapay.cancel(o.pay.id));
  if (st && st.status === 'settlement') return onSettlement(o, st, base);
  o.status = 'cancelled';
  await orders.save(o);
  return o;
}

/** Build ulang tanpa bayar lagi. User dibatasi, admin tidak. */
async function retry(o, base, isAdmin) {
  if (o.status !== 'paid' || o.build !== 'failed') throw new HttpError(409, 'NOT_RETRYABLE', 'Pesanan ini tidak bisa di-build ulang.');
  if (!isAdmin && (o.attempts || 0) >= MAX_USER_RETRIES) {
    throw new HttpError(429, 'RETRY_LIMIT', 'Batas build ulang tercapai. Hubungi admin.');
  }
  return startBuild(o, base);
}

/** Admin menyetujui pesanan berstatus review (nominal tidak cocok) setelah memeriksanya manual. */
async function approve(o, base) {
  if (o.status !== 'review') throw new HttpError(409, 'NOT_REVIEW', 'Pesanan ini tidak sedang menunggu persetujuan.');
  o.status = 'paid';
  o.paid_at = Date.now();
  o.note = (o.note || '') + ' Disetujui admin.';
  await orders.save(o);
  await orders.stat('paid');
  await orders.stat('revenue', o.price);
  return startBuild(o, base);
}

/** Callback dari workflow GitHub. */
async function buildEvent(o, { status, run_url, message }) {
  if (o.status !== 'paid') throw new HttpError(409, 'NOT_PAID', 'Pesanan belum lunas.');
  if (run_url && /^https:\/\/github\.com\//.test(run_url)) o.run_url = run_url;
  if (status === 'building') {
    if (o.build !== 'done') o.build = 'building';
  } else if (status === 'done') {
    const asset = await github.releaseAsset(o.id);
    if (!asset) throw new HttpError(409, 'NO_ASSET', 'APK belum ditemukan di release.');
    if (o.build !== 'done') await orders.stat('builds_done');
    o.build = 'done';
    o.build_done_at = Date.now();
    o.apk = { name: asset.name, size: asset.size };
  } else if (status === 'failed') {
    if (o.build !== 'failed') await orders.stat('builds_failed');
    o.build = 'failed';
    o.build_error = 'Build gagal. Biasanya karena ikon atau data aplikasi bermasalah. Coba build ulang atau hubungi admin.';
    o.build_error_detail = String(message || '').slice(0, 500);
  } else {
    throw new HttpError(422, 'VALIDATION', 'status tidak dikenal.');
  }
  await orders.save(o);
  return o;
}

/** Bentuk pesanan yang dikirim ke klien. Rincian internal hanya untuk admin. */
function view(o, { admin = false } = {}) {
  const v = {
    id: o.id,
    status: o.status,
    build: o.build,
    price: o.price,
    app: { name: o.app.name, url: o.app.url, package: o.app.package, color: o.app.color, has_icon: !!o.app.has_icon },
    created: o.created,
    paid_at: o.paid_at || null,
    build_done_at: o.build_done_at || null,
    attempts: o.attempts || 0,
    build_error: o.build_error || null,
    note: o.note || null,
    pay: o.status === 'pending'
      ? { total: o.pay.total, fee: o.pay.fee, fee_by: o.pay.fee_by, qr_url: o.pay.qr_url, pay_url: o.pay.pay_url, expiry_at: o.pay.expiry_at }
      : { total: o.pay.total },
    apk: o.apk || null,
    retry_left: Math.max(0, MAX_USER_RETRIES - (o.attempts || 0)),
    download_url: o.build === 'done' ? `/api/order?id=${o.id}&download=1&t=${session.link('dl', o.id, 10 * 60 * 1000)}` : null
  };
  if (admin) {
    v.email = o.email;
    v.uid = o.uid;
    v.run_url = o.run_url || null;
    v.build_error_detail = o.build_error_detail || null;
    v.pay_id = o.pay.id;
  }
  return v;
}

module.exports = { refresh, cancel, retry, approve, buildEvent, startBuild, view, MAX_USER_RETRIES };
