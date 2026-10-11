(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const when = (ms) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
  const hostOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const guessName = (u) => { const h = hostOf(u).split('.')[0] || ''; return h ? h.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 30) : ''; };

  const view = $('#app');
  const S = { settings: null, token: localStorage.getItem('w2a_token') || '', me: null };
  let timers = [];
  let routeId = 0;

  /* ---------- helper ---------- */
  async function api(path, { method = 'GET', body, query } = {}) {
    const qs = query ? '?' + new URLSearchParams(query) : '';
    const r = await fetch('/api' + path + qs, {
      method,
      headers: { ...(S.token ? { authorization: 'Bearer ' + S.token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let j;
    try { j = await r.json(); } catch { throw new Error('Server tidak merespons dengan benar. Coba lagi.'); }
    if (!j.success) {
      const e = new Error(j.error?.message || 'Terjadi kesalahan.');
      e.code = j.error?.code; e.status = r.status;
      if (r.status === 401 && S.token) { setSession(''); S.me = null; drawChrome(); }
      throw e;
    }
    return j.data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  const setSession = (t) => { S.token = t; t ? localStorage.setItem('w2a_token', t) : localStorage.removeItem('w2a_token'); };
  const isAdmin = () => S.me?.role === 'admin';
  const isUser = () => S.me?.role === 'user';
  const errBox = (e) => `<div class="notice bad" role="alert">${esc(e.message || e)}</div>`;
  const stopTimers = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; };
  const busy = (btn, on, label) => { if (!btn) return; btn.disabled = on; if (label) btn.textContent = on ? 'Memproses…' : label; };
  const go = (h) => { if (location.hash === h) router(); else location.hash = h; };

  /* ---------- kerangka ---------- */
  function drawChrome() {
    const s = S.settings;
    document.title = s.site_name;
    document.documentElement.style.setProperty('--brand', s.brand_color);
    $('#brandName').textContent = s.site_name;
    $('#brandLogo').src = s.logo_url;
    const cur = location.hash.split('?')[0] || '#/';
    const a = (h, t, cls = '') => `<a href="${h}" class="${cls}"${cur === h ? ' aria-current="page"' : ''}>${t}</a>`;
    let n = '';
    if (isAdmin()) n = a('#/admin', 'Ringkasan') + a('#/admin/pesanan', 'Pesanan') + a('#/admin/pengguna', 'Pengguna') + a('#/admin/pengaturan', 'Pengaturan') + '<button type="button" id="out">Keluar</button>';
    else if (isUser()) n = a('#/buat', 'Buat APK') + a('#/pesanan', 'Pesanan saya') + `<button type="button" id="out">Keluar</button>`;
    else n = a('#/masuk', 'Masuk') + a('#/daftar', 'Daftar', 'cta');
    $('#nav').innerHTML = n;
    $('#out')?.addEventListener('click', () => { setSession(''); S.me = null; sessionStorage.removeItem('w2a_draft'); go('#/'); });
    $('#foot').innerHTML = (s.contact ? `<p>${esc(s.contact)}</p>` : '') + `<p>© ${new Date().getFullYear()} ${esc(s.site_name)}</p>`;
  }

  function ico(name, color, icon, cls = '') {
    const letter = (String(name).match(/[\p{L}\p{N}]/u) || ['A'])[0].toUpperCase();
    return `<div class="ico ${cls}">${icon ? `<img src="${esc(icon)}" alt="">` : `<span style="background:${esc(color)}">${esc(letter)}</span>`}</div>`;
  }

  function phone({ name, url, color, icon }) {
    const n = name || 'Nama Aplikasi';
    return `<div class="stage" aria-label="Pratinjau aplikasi">
      <div class="phone" style="--c:${esc(color)}"><div class="bar"></div><div class="screen">
        ${ico(n, color, icon)}<div class="nm">${esc(n)}</div><div class="ht">${esc(hostOf(url) || 'alamat-websitemu.com')}</div>
        <div class="sk"></div><div class="sk w3"></div><div class="sk w2"></div></div></div>
      <div class="home-tile">${ico(n, color, icon, 'sm')}<span>Seperti inilah di layar utama</span></div></div>`;
  }

  function orderState(o) {
    if (o.status === 'pending') return ['Menunggu pembayaran', 'warn'];
    if (o.status === 'expired') return ['Kedaluwarsa', 'bad'];
    if (o.status === 'cancelled') return ['Dibatalkan', 'bad'];
    if (o.status === 'review') return ['Perlu diperiksa', 'warn'];
    if (o.build === 'done') return ['Selesai', 'ok'];
    if (o.build === 'failed') return ['Build gagal', 'bad'];
    if (o.build === 'building') return ['Sedang dibangun', ''];
    return ['Antre build', ''];
  }
  const chip = (o) => { const [t, c] = orderState(o); return `<span class="chip ${c}">${t}</span>`; };

  /* ---------- beranda ---------- */
  function viewHome() {
    const s = S.settings;
    const draft = JSON.parse(sessionStorage.getItem('w2a_draft') || '{}');
    view.innerHTML = `
      <section class="hero">
        <div>
          <h1>Ketik alamat websitemu. Lihat aplikasinya.</h1>
          <p class="lead">${esc(s.tagline)}</p>
          <form class="try" id="try">
            <label class="field"><span>Alamat website</span><input id="tu" inputmode="url" autocomplete="off" placeholder="tokosaya.com" value="${esc(draft.app_url || '')}"></label>
            <label class="field"><span>Nama aplikasi</span><input id="tn" maxlength="30" autocomplete="off" placeholder="Toko Saya" value="${esc(draft.app_name || '')}"></label>
            <div class="row"><button class="btn primary big">Buat aplikasi ini</button><span class="price">${rp(s.price)} <small>sekali bayar</small></span></div>
          </form>
        </div>
        <div id="prev"></div>
      </section>
      <ol class="flow">
        <li><b>Isi data aplikasi</b><span>Alamat web, nama, warna, dan ikon.</span></li>
        <li><b>Bayar dengan QRIS</b><span>Scan dari e-wallet atau m-banking apa saja.</span></li>
        <li><b>Tunggu beberapa menit</b><span>Aplikasimu dibuat otomatis setelah pembayaran masuk.</span></li>
        <li><b>Unduh APK</b><span>Pasang di Android atau bagikan ke pelangganmu.</span></li>
      </ol>
      <section class="facts">
        <div><h3>Yang kamu dapat</h3><p>File APK siap pasang untuk Android 5.0 ke atas, dengan nama, warna, dan ikon sesuai pilihanmu.</p></div>
        <div><h3>Cara kerjanya</h3><p>Aplikasi menampilkan websitemu di dalam layar penuh. Isi website tetap diperbarui dari servermu, tanpa perlu membuat APK baru.</p></div>
        <div><h3>Perlu diketahui</h3><p>Aplikasi butuh koneksi internet. Pengunggahan ke Google Play tidak termasuk.</p></div>
      </section>`;
    const u = $('#tu'), n = $('#tn');
    let nameTouched = !!n.value;
    const draw = () => ($('#prev').innerHTML = phone({ name: n.value.trim() || guessName(u.value), url: u.value, color: s.brand_color }));
    u.addEventListener('input', () => { if (!nameTouched) n.placeholder = guessName(u.value) || 'Toko Saya'; draw(); });
    n.addEventListener('input', () => { nameTouched = true; draw(); });
    draw();
    $('#try').addEventListener('submit', (e) => {
      e.preventDefault();
      sessionStorage.setItem('w2a_draft', JSON.stringify({ app_url: u.value.trim(), app_name: n.value.trim() || guessName(u.value) }));
      go('#/buat');
    });
  }

  /* ---------- masuk & daftar ---------- */
  function afterAuth(data) {
    setSession(data.token); S.me = null;
    return loadMe().then(() => { drawChrome(); const next = sessionStorage.getItem('w2a_next'); sessionStorage.removeItem('w2a_next'); go(next || (isAdmin() ? '#/admin' : '#/buat')); });
  }

  function authForm({ title, fields, button, path, foot }) {
    view.innerHTML = `<div class="narrow panel"><h1 style="font-size:1.8rem">${title}</h1><div id="err"></div>
      <form id="f" novalidate>${fields}<button class="btn primary" style="width:100%">${button}</button></form>${foot || ''}</div>`;
    $('#f input')?.focus();
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); $('#err').innerHTML = ''; busy(btn, true, button);
      const body = Object.fromEntries(new FormData(e.target));
      try { await afterAuth(await api(path, { method: 'POST', body })); } catch (err) { $('#err').innerHTML = errBox(err); busy(btn, false, button); }
    });
  }

  const viewLogin = () => authForm({
    title: 'Masuk', button: 'Masuk', path: '/auth/login',
    fields: `<label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
             <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>`,
    foot: '<p class="hint" style="margin:1rem 0 0">Belum punya akun? <a href="#/daftar">Daftar</a></p>'
  });
  const viewRegister = () => authForm({
    title: 'Buat akun', button: 'Daftar', path: '/auth/register',
    fields: `<label class="field"><span>Nama</span><input name="name" autocomplete="name" required></label>
             <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
             <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required><small class="hint">Minimal 8 karakter.</small></label>`,
    foot: '<p class="hint" style="margin:1rem 0 0">Sudah punya akun? <a href="#/masuk">Masuk</a></p>'
  });
  const viewAdminLogin = () => authForm({
    title: 'Masuk admin', button: 'Masuk', path: '/auth/admin',
    fields: `<label class="field"><span>Nama admin</span><input name="username" autocomplete="username" required></label>
             <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>`
  });

  /* ---------- buat pesanan ---------- */
  function readIcon(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 512;
        const x = c.getContext('2d'), side = Math.min(img.width, img.height);
        x.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
        URL.revokeObjectURL(url);
        let d = c.toDataURL('image/png');
        if (d.length > 380000) d = c.toDataURL('image/jpeg', 0.86);
        resolve(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File itu bukan gambar yang bisa dibaca.')); };
      img.src = url;
    });
  }

  function viewCreate() {
    const s = S.settings;
    const d = JSON.parse(sessionStorage.getItem('w2a_draft') || '{}');
    let icon = d.icon || '';
    view.innerHTML = `
      <div class="head"><h1>Buat aplikasi</h1></div>
      ${s.ready ? '' : '<div class="notice warn">Layanan belum sepenuhnya siap. Pembuatan pesanan mungkin gagal sampai admin melengkapi pengaturan.</div>'}
      <div class="split">
        <form class="panel" id="f" novalidate>
          <div id="err"></div>
          <label class="field"><span>Alamat website</span><input id="u" inputmode="url" autocomplete="off" placeholder="https://tokosaya.com" value="${esc(d.app_url || '')}" required><small class="hint">Harus memakai HTTPS.</small></label>
          <label class="field"><span>Nama aplikasi</span><input id="n" maxlength="30" autocomplete="off" value="${esc(d.app_name || '')}" required></label>
          <div class="field"><span>Warna tema</span><div class="row"><input id="c" type="color" value="${esc(d.color || s.brand_color)}" aria-label="Pilih warna"><code id="ch">${esc(d.color || s.brand_color)}</code></div><small class="hint">Dipakai untuk status bar aplikasi dan ikon bawaan.</small></div>
          <label class="field"><span>Ikon (opsional)</span><input id="i" type="file" accept="image/png,image/jpeg,image/webp"><small class="hint">Gambar persegi, minimal 192×192. Tanpa ikon, dibuat ikon huruf pertama nama.</small></label>
          <details class="more"><summary>Pengaturan lanjutan</summary>
            <label class="field"><span>Package name</span><input id="p" autocomplete="off" placeholder="otomatis, mis. app.w2a.tokosaya"><small class="hint">Isi hanya jika perlu ID tetap, contoh com.tokosaya.app.</small></label></details>
          <button class="btn primary big" id="go">Lanjut ke pembayaran</button>
        </form>
        <div><div id="prev"></div><div class="panel" style="margin-top:1.2rem"><b>Total ${rp(s.price)}</b><p class="hint" style="margin:.3rem 0 0">Dibayar dengan QRIS. Jumlah akhir tampil di langkah berikutnya.</p></div></div>
      </div>`;
    const U = $('#u'), N = $('#n'), C = $('#c');
    const draw = () => { $('#ch').textContent = C.value; $('#prev').innerHTML = phone({ name: N.value.trim() || guessName(U.value), url: U.value, color: C.value, icon }); };
    [U, N, C].forEach((el) => el.addEventListener('input', draw));
    $('#i').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) { icon = ''; return draw(); }
      try { icon = await readIcon(f); draw(); } catch (err) { icon = ''; e.target.value = ''; $('#err').innerHTML = errBox(err); draw(); }
    });
    draw();
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); $('#err').innerHTML = ''; const btn = $('#go'); busy(btn, true, 'Lanjut ke pembayaran');
      try {
        const o = await api('/orders', { method: 'POST', body: { app_url: U.value.trim(), app_name: N.value.trim() || guessName(U.value), color: C.value, package: $('#p').value.trim(), icon: icon || undefined } });
        sessionStorage.removeItem('w2a_draft'); go('#/pesanan/' + o.id);
      } catch (err) { $('#err').innerHTML = errBox(err); busy(btn, false, 'Lanjut ke pembayaran'); view.scrollIntoView(); }
    });
  }

  /* ---------- pesanan ---------- */
  async function viewOrders(m, id) {
    view.innerHTML = '<div class="head"><h1>Pesanan saya</h1><a class="btn primary" href="#/buat">Buat APK baru</a></div><div id="list" class="olist">Memuat…</div>';
    try {
      const r = await api('/orders');
      if (id !== routeId) return;
      $('#list').innerHTML = r.items.length ? r.items.map((o) => `<a class="orow" href="#/pesanan/${o.id}">${ico(o.app.name, o.app.color, '', 'sm')}
        <div class="grow"><b>${esc(o.app.name)}</b><span>${esc(hostOf(o.app.url))} · ${when(o.created)}</span></div>${chip(o)}<span>${rp(o.price)}</span></a>`).join('')
        : '<div class="empty">Belum ada pesanan. <a href="#/buat">Buat APK pertamamu</a>.</div>';
    } catch (e) { $('#list').innerHTML = errBox(e); }
  }

  const STEPS = ['Pembayaran diterima', 'Menunggu antrean build', 'Membangun aplikasi', 'APK siap diunduh'];
  function timeline(o) {
    const at = o.build === 'done' ? 4 : o.build === 'building' ? 2 : 1; // indeks langkah yang sedang berjalan
    return `<ol class="tl" aria-label="Progres">${STEPS.map((t, i) => `<li class="${i < at ? 'done' : i === at && o.build !== 'failed' ? 'now' : ''}">${t}</li>`).join('')}</ol>`;
  }

  function orderBody(o) {
    const contact = S.settings.contact ? ` ${esc(S.settings.contact)}` : '';
    if (o.status === 'pending') {
      const qr = safeUrl(o.pay.qr_url), link = safeUrl(o.pay.pay_url);
      return `<div class="pay"><div class="qr">${qr ? `<img src="${esc(qr)}" alt="Kode QRIS untuk membayar ${rp(o.pay.total)}">` : '<span class="hint">QR tidak tersedia</span>'}</div>
        <div><div class="amount">${rp(o.pay.total)}</div>
        ${o.pay.fee ? `<p class="hint">Sudah termasuk biaya QRIS ${rp(o.pay.fee)}${o.pay.fee_by === 'buyer' ? '' : ''}.</p>` : ''}
        <p class="hint" id="cd" aria-live="off"></p>
        <div class="row">${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Buka halaman pembayaran</a>` : ''}<button class="btn danger" id="cancel" type="button">Batalkan</button></div></div></div>
        <p class="hint" style="margin-top:1rem">Scan dengan e-wallet atau m-banking apa pun yang mendukung QRIS. Halaman ini memeriksa pembayaran otomatis, tidak perlu dimuat ulang.</p>`;
    }
    if (o.status === 'expired') return `<div class="notice bad">Waktu pembayaran habis. Pesanan ini tidak bisa dibayar lagi.</div><a class="btn primary" href="#/buat">Buat pesanan baru</a>`;
    if (o.status === 'cancelled') return `<div class="notice bad">Pesanan ini dibatalkan.</div><a class="btn primary" href="#/buat">Buat pesanan baru</a>`;
    if (o.status === 'review') return `<div class="notice warn">Pembayaranmu sudah masuk tetapi perlu diperiksa admin sebelum aplikasi dibuat.${contact}</div>`;
    if (o.build === 'done') {
      return `${timeline(o)}<a class="btn primary big" href="${esc(o.download_url)}">Unduh APK${o.apk ? ` (${size(o.apk.size)})` : ''}</a>
        <p class="hint" style="margin-top:1rem">Cara memasang:</p><ol class="steps-list"><li>Buka file APK di HP Android.</li><li>Jika diminta, izinkan pemasangan dari sumber ini.</li><li>Ketuk Pasang, lalu buka aplikasinya.</li></ol>`;
    }
    if (o.build === 'failed') {
      return `${timeline(o)}<div class="notice bad">${esc(o.build_error || 'Build gagal.')}</div>
        ${o.retry_left > 0 ? '<button class="btn primary" id="retry" type="button">Coba build ulang</button>' : `<p>Batas build ulang tercapai.${contact || ' Hubungi admin.'}</p>`}`;
    }
    return `${timeline(o)}<p class="hint">Biasanya selesai dalam 3 sampai 6 menit. Kamu boleh menutup halaman ini; pesanan tetap ada di menu Pesanan saya.</p>`;
  }

  async function viewOrder(m, id) {
    const oid = m[1];
    view.innerHTML = '<p class="loading">Memuat pesanan…</p>';
    let sig = '';
    const render = (o) => {
      view.innerHTML = `<div class="head"><div class="row">${ico(o.app.name, o.app.color, '', 'sm')}<div><h1 style="margin:0">${esc(o.app.name)}</h1><span class="hint">${esc(hostOf(o.app.url))} · pesanan ${o.id}</span></div></div>${chip(o)}</div>
        <div class="panel" id="body" aria-live="polite">${orderBody(o)}</div><p style="margin-top:1rem"><a href="#/pesanan">← Semua pesanan</a></p>`;
      $('#cancel')?.addEventListener('click', () => act('cancel', $('#cancel')));
      $('#retry')?.addEventListener('click', () => act('retry', $('#retry')));
      stopTimers();
      if (o.status === 'pending' && o.pay.expiry_at) {
        const tick = () => { const left = Math.max(0, Math.round((o.pay.expiry_at - Date.now()) / 1000)); const el = $('#cd'); if (el) el.textContent = left ? `Berlaku ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} lagi.` : 'Waktu pembayaran habis, memeriksa…'; };
        tick(); timers.push(setInterval(tick, 1000));
      }
      schedule(o);
    };
    const schedule = (o) => {
      if (o.status === 'pending' || (o.status === 'paid' && (o.build === 'queued' || o.build === 'building' || o.build === 'none'))) {
        timers.push(setTimeout(poll, 4000));
      }
    };
    const apply = (o) => { const s = [o.status, o.build, o.attempts, o.download_url, o.retry_left].join('|'); if (s !== sig) { sig = s; render(o); } else schedule(o); };
    async function poll() {
      if (id !== routeId) return;
      try { const o = await api('/order', { query: { id: oid } }); if (id === routeId) apply(o); }
      catch (e) { if (id === routeId) timers.push(setTimeout(poll, 8000)); }
    }
    async function act(action, btn) {
      busy(btn, true); try { const o = await api('/order', { method: 'POST', body: { id: oid, action } }); sig = ''; if (id === routeId) apply(o); } catch (e) { toast(e.message); busy(btn, false); }
    }
    try { const o = await api('/order', { query: { id: oid } }); if (id === routeId) apply(o); }
    catch (e) { if (id === routeId) view.innerHTML = errBox(e) + '<p><a href="#/pesanan">← Semua pesanan</a></p>'; }
  }

  /* ---------- admin ---------- */
  const pager = (r, base) => { const pages = Math.max(1, Math.ceil(r.total / r.per_page)); return `<div class="pager"><button class="btn sm" id="pp" ${r.page <= 1 ? 'disabled' : ''}>Sebelumnya</button><span>Halaman ${r.page} dari ${pages}</span><button class="btn sm" id="np" ${r.page >= pages ? 'disabled' : ''}>Berikutnya</button></div>`; };

  async function viewAdminHome(m, id) {
    view.innerHTML = '<div class="head"><h1>Ringkasan</h1></div><div id="st">Memuat…</div>';
    try {
      const s = await api('/admin/stats'); if (id !== routeId) return;
      const t = (n, l) => `<div class="tile-stat"><b>${n}</b><span>${l}</span></div>`;
      $('#st').innerHTML = (S.settings.ready ? '' : '<div class="notice warn">Layanan belum lengkap. Periksa env <code>JAYAPAY_API_KEY</code>, <code>GH_REPO</code>, <code>GH_TOKEN</code>, dan Redis.</div>') +
        `<div class="tiles">${t(rp(s.revenue), 'Pendapatan kotor')}${t(s.paid, 'Pesanan lunas')}${t(s.orders, 'Pesanan dibuat')}${t(s.users, 'Pengguna')}${t(s.builds_done, 'Build selesai')}${t(s.builds_failed, 'Build gagal')}</div>
         <div class="row"><a class="btn" href="#/admin/pesanan?status=failed">Lihat build gagal</a><a class="btn" href="#/admin/pesanan?status=review">Perlu diperiksa</a><a class="btn" href="#/admin/pengaturan">Atur nama, logo, harga</a></div>`;
    } catch (e) { $('#st').innerHTML = errBox(e); }
  }

  async function viewAdminOrders(m, id, params) {
    const status = params.get('status') || '', q = params.get('q') || '', page = Number(params.get('page')) || 1;
    const opts = [['', 'Semua'], ['pending', 'Menunggu bayar'], ['paid', 'Lunas'], ['done', 'Build selesai'], ['failed', 'Build gagal'], ['review', 'Perlu diperiksa'], ['expired', 'Kedaluwarsa'], ['cancelled', 'Dibatalkan']];
    view.innerHTML = `<div class="head"><h1>Pesanan</h1></div>
      <form class="row" id="flt" style="margin-bottom:1rem"><select id="fs" style="width:auto" aria-label="Filter status">${opts.map(([v, l]) => `<option value="${v}"${v === status ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="fq" placeholder="Cari ID, email, nama app" value="${esc(q)}" style="width:auto;flex:1;min-width:200px"><button class="btn">Terapkan</button></form><div id="list">Memuat…</div>`;
    $('#flt').addEventListener('submit', (e) => { e.preventDefault(); go(`#/admin/pesanan?status=${encodeURIComponent($('#fs').value)}&q=${encodeURIComponent($('#fq').value.trim())}`); });
    async function load() {
      try {
        const r = await api('/admin/orders', { query: { status, q, page } }); if (id !== routeId) return;
        const rows = r.items.map((o) => {
          const acts = [o.build === 'failed' ? ['retry', 'Build ulang'] : null, o.status === 'review' ? ['approve', 'Setujui'] : null, o.status === 'pending' ? ['cancel', 'Batalkan'] : null, ['refresh', 'Segarkan']].filter(Boolean)
            .map(([a, l]) => `<button class="btn sm" data-a="${a}" data-id="${o.id}">${l}</button>`).join(' ');
          const extra = [o.note, o.build_error_detail, o.run_url ? `<a href="${esc(safeUrl(o.run_url))}" target="_blank" rel="noopener">Log build</a>` : ''].filter(Boolean).map((x) => (x.startsWith('<a') ? x : `<div class="hint">${esc(x)}</div>`)).join('');
          return `<tr><td><span class="mono">${o.id}</span><div class="hint">${when(o.created)}</div></td><td><b>${esc(o.app.name)}</b><div class="hint">${esc(hostOf(o.app.url))}</div>${extra}</td><td>${esc(o.email)}</td><td>${chip(o)}</td><td class="num">${rp(o.price)}</td><td>${acts}</td></tr>`;
        }).join('');
        $('#list').innerHTML = (r.items.length ? `<div class="tablewrap"><table><thead><tr><th>Pesanan</th><th>Aplikasi</th><th>Pengguna</th><th>Status</th><th class="num">Harga</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Tidak ada pesanan.</div>') + pager(r);
        if (r.scanned && r.scanned >= 500) $('#list').insertAdjacentHTML('beforeend', '<p class="hint" style="text-align:center">Pencarian mencakup 500 pesanan terbaru.</p>');
        const nav = (p) => go(`#/admin/pesanan?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${p}`);
        $('#pp')?.addEventListener('click', () => nav(page - 1)); $('#np')?.addEventListener('click', () => nav(page + 1));
        $('#list').querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', async () => {
          if (b.dataset.a === 'cancel' && !confirm('Batalkan pesanan ini?')) return;
          busy(b, true); try { await api('/admin/orders', { method: 'POST', body: { id: b.dataset.id, action: b.dataset.a } }); toast('Selesai'); load(); } catch (e) { toast(e.message); busy(b, false); }
        }));
      } catch (e) { $('#list').innerHTML = errBox(e); }
    }
    load();
  }

  async function viewAdminUsers(m, id, params) {
    const page = Number(params.get('page')) || 1;
    view.innerHTML = '<div class="head"><h1>Pengguna</h1></div><div id="list">Memuat…</div>';
    try {
      const r = await api('/admin/users', { query: { page } }); if (id !== routeId) return;
      const rows = r.items.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${when(u.created)}</td><td>${u.disabled ? '<span class="chip bad">Nonaktif</span>' : '<span class="chip ok">Aktif</span>'}</td>
        <td><button class="btn sm" data-id="${u.id}" data-d="${u.disabled ? 0 : 1}">${u.disabled ? 'Aktifkan' : 'Nonaktifkan'}</button></td></tr>`).join('');
      $('#list').innerHTML = (r.items.length ? `<div class="tablewrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Daftar</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Belum ada pengguna.</div>') + pager(r);
      $('#pp')?.addEventListener('click', () => go('#/admin/pengguna?page=' + (page - 1))); $('#np')?.addEventListener('click', () => go('#/admin/pengguna?page=' + (page + 1)));
      $('#list').querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', async () => {
        busy(b, true); try { await api('/admin/users', { method: 'PATCH', body: { id: b.dataset.id, disabled: b.dataset.d === '1' } }); viewAdminUsers(m, id, params); } catch (e) { toast(e.message); busy(b, false); }
      }));
    } catch (e) { $('#list').innerHTML = errBox(e); }
  }

  async function viewAdminSettings(m, id) {
    view.innerHTML = '<div class="head"><h1>Pengaturan</h1></div><p class="loading">Memuat…</p>';
    let s;
    try { s = await api('/admin/settings'); } catch (e) { view.innerHTML = errBox(e); return; }
    if (id !== routeId) return;
    let logo = '', removeLogo = false;
    view.innerHTML = `<div class="head"><h1>Pengaturan</h1></div><form class="panel" id="f" style="max-width:640px" novalidate><div id="err"></div>
      <label class="field"><span>Nama web</span><input id="sn" maxlength="40" value="${esc(s.site_name)}" required></label>
      <label class="field"><span>Tagline</span><input id="tg" maxlength="140" value="${esc(s.tagline)}"></label>
      <label class="field"><span>Harga per APK (Rp)</span><input id="pr" inputmode="numeric" value="${s.price}" required><small class="hint">${rp(s.min_price)} sampai ${rp(s.max_price)}. Berlaku untuk pesanan baru; pesanan lama memakai harga saat dibuat.</small></label>
      <div class="field"><span>Warna merek</span><div class="row"><input id="bc" type="color" value="${esc(s.brand_color)}" aria-label="Warna merek"><code id="bch">${esc(s.brand_color)}</code></div></div>
      <label class="field"><span>Kontak bantuan</span><input id="ct" maxlength="100" value="${esc(s.contact)}" placeholder="WhatsApp 0812xxxxxxx"><small class="hint">Tampil di footer dan saat ada masalah pesanan.</small></label>
      <div class="field"><span>Logo</span><div class="logo-edit"><img id="lg" src="${esc(s.logo_url)}" alt="Logo saat ini"><input id="lf" type="file" accept="image/png,image/jpeg,image/webp" style="width:auto"><button class="btn sm" id="lr" type="button">Hapus logo</button></div><small class="hint">PNG, JPEG, atau WebP, maksimal 250 KB. Dipakai juga sebagai favicon.</small></div>
      <button class="btn primary" id="sv">Simpan</button></form>`;
    $('#bc').addEventListener('input', (e) => ($('#bch').textContent = e.target.value));
    $('#lf').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 256 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); logo = c.toDataURL('image/png'); removeLogo = false; $('#lg').src = logo; }; img.onerror = () => ($('#err').innerHTML = errBox('File itu bukan gambar yang bisa dibaca.')); img.src = r.result; };
      r.readAsDataURL(f);
    });
    $('#lr').addEventListener('click', () => { logo = ''; removeLogo = true; $('#lf').value = ''; $('#lg').src = '/api/logo?v=default'; toast('Logo akan dihapus saat disimpan'); });
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); $('#err').innerHTML = ''; busy($('#sv'), true, 'Simpan');
      const body = { site_name: $('#sn').value, tagline: $('#tg').value, price: $('#pr').value.replace(/\D/g, ''), brand_color: $('#bc').value, contact: $('#ct').value };
      if (logo) body.logo = logo; else if (removeLogo) body.remove_logo = true;
      try {
        const r = await api('/admin/settings', { method: 'PUT', body });
        S.settings = { ...S.settings, ...r, ready: S.settings.ready }; drawChrome(); toast('Pengaturan disimpan');
        logo = ''; removeLogo = false; $('#lg').src = r.logo_url;
      } catch (err) { $('#err').innerHTML = errBox(err); }
      busy($('#sv'), false, 'Simpan');
    });
  }

  /* ---------- router ---------- */
  const U = 'user', A = 'admin';
  const routes = [
    [/^#\/?$/, viewHome], [/^#\/masuk$/, viewLogin], [/^#\/daftar$/, viewRegister],
    [/^#\/buat$/, viewCreate, U], [/^#\/pesanan$/, viewOrders, U], [/^#\/pesanan\/([0-9A-F]{16})$/, viewOrder, U],
    [/^#\/admin\/masuk$/, viewAdminLogin],
    [/^#\/admin$/, viewAdminHome, A], [/^#\/admin\/pesanan$/, viewAdminOrders, A], [/^#\/admin\/pengguna$/, viewAdminUsers, A], [/^#\/admin\/pengaturan$/, viewAdminSettings, A]
  ];

  async function loadMe() {
    if (!S.token) { S.me = null; return; }
    try { S.me = await api('/auth/me'); } catch { S.me = null; }
  }

  async function router() {
    stopTimers();
    const id = ++routeId;
    const [path, qs] = (location.hash || '#/').split('?');
    const hit = routes.map(([re, fn, role]) => [re.exec(path), fn, role]).find(([m]) => m);
    if (!hit) return go('#/');
    const [m, fn, role] = hit;
    if ((fn === viewLogin || fn === viewRegister) && S.me) return go(isAdmin() ? '#/admin' : '#/buat');
    if (role === U && !isUser()) { if (isAdmin()) return go('#/admin'); sessionStorage.setItem('w2a_next', location.hash); return go('#/masuk'); }
    if (role === A && !isAdmin()) return go('#/admin/masuk');
    drawChrome();
    view.scrollTo?.(0, 0); window.scrollTo(0, 0);
    await fn(m, id, new URLSearchParams(qs || ''));
  }

  async function boot() {
    try { S.settings = await api('/public'); } catch (e) {
      S.settings = { site_name: 'Web2APK', tagline: '', price: 0, brand_color: '#2f4bff', contact: '', logo_url: '/api/logo', ready: false };
      view.innerHTML = errBox(e);
    }
    await loadMe();
    window.addEventListener('hashchange', router);
    router();
  }
  boot();
})();
