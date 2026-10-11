/** Pengaturan situs yang diubah admin: nama, tagline, harga, warna, kontak, logo. */
const store = require('./store');
const v = require('./validate');

const KEY = 'w2a:settings';
const LOGO = 'w2a:logo';
const MIN_PRICE = 1000; // batas JayaPay
const MAX_PRICE = 10000000;
const LOGO_MAX = 250 * 1024;

const defaults = () => ({
  site_name: process.env.SITE_NAME || 'Web2APK',
  tagline: 'Ubah websitemu jadi aplikasi Android (APK) dalam beberapa menit.',
  price: Number(process.env.DEFAULT_PRICE) || 25000,
  brand_color: '#2f4bff',
  contact: '',
  has_logo: false,
  logo_v: 0
});

async function get() {
  const raw = await store.cmd('GET', KEY);
  return { ...defaults(), ...(raw ? JSON.parse(raw) : {}) };
}

async function update(patch) {
  const cur = await get();
  const next = { ...cur };
  if (patch.site_name !== undefined) {
    next.site_name = v.clean(patch.site_name, 40);
    if (next.site_name.length < 2) throw v.bad('Nama web minimal 2 karakter.');
  }
  if (patch.tagline !== undefined) next.tagline = v.clean(patch.tagline, 140);
  if (patch.contact !== undefined) next.contact = v.clean(patch.contact, 100);
  if (patch.brand_color !== undefined) next.brand_color = v.color(patch.brand_color, cur.brand_color);
  if (patch.price !== undefined) {
    const p = typeof patch.price === 'string' && /^\d+$/.test(patch.price) ? Number(patch.price) : patch.price;
    if (!Number.isSafeInteger(p) || p < MIN_PRICE || p > MAX_PRICE) {
      throw v.bad(`Harga harus bilangan bulat rupiah antara ${MIN_PRICE} dan ${MAX_PRICE}.`);
    }
    next.price = p;
  }
  let logo = null;
  if (patch.logo) {
    logo = v.image(patch.logo, LOGO_MAX, 'Logo').dataUrl;
    next.has_logo = true;
    next.logo_v = Date.now();
  } else if (patch.remove_logo) {
    next.has_logo = false;
    next.logo_v = Date.now();
  }
  await store.cmd('SET', KEY, JSON.stringify(next));
  if (logo) await store.cmd('SET', LOGO, logo);
  else if (patch.remove_logo) await store.cmd('DEL', LOGO);
  return next;
}

const logo = () => store.cmd('GET', LOGO);

/** Bagian yang aman dibaca siapa saja. */
const publicView = (s) => ({
  site_name: s.site_name,
  tagline: s.tagline,
  price: s.price,
  brand_color: s.brand_color,
  contact: s.contact,
  logo_url: `/api/logo?v=${s.logo_v}`
});

module.exports = { get, update, logo, publicView, defaults, MIN_PRICE, MAX_PRICE };
