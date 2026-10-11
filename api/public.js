// Pengaturan situs untuk halaman depan (tanpa login): nama, tagline, harga, warna, kontak, logo.
const store = require('../lib/store');
const settings = require('../lib/settings');
const { fail } = require('../lib/http');
const { HttpError } = require('../lib/errors');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Gunakan method GET untuk endpoint ini.');
    const ready = store.enabled() && !!process.env.JAYAPAY_API_KEY && !!process.env.GH_TOKEN && !!process.env.GH_REPO;
    const s = store.enabled() ? await settings.get() : settings.defaults();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=60');
    res.status(200).json({ success: true, data: { ...settings.publicView(s), ready } });
  } catch (e) {
    fail(res, e);
  }
};
