// Logo situs. Bila admin belum mengunggah, kirim logo bawaan.
const store = require('../lib/store');
const settings = require('../lib/settings');

const FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#2f4bff"/><rect x="18" y="14" width="28" height="36" rx="5" fill="none" stroke="#fff" stroke-width="4"/><circle cx="32" cy="43" r="2.6" fill="#fff"/></svg>`;

module.exports = async (req, res) => {
  try {
    const data = store.enabled() ? await settings.logo() : null;
    const m = data && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(data);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    if (m) {
      res.setHeader('Content-Type', m[1]);
      return res.status(200).end(Buffer.from(m[2], 'base64'));
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.status(200).end(FALLBACK);
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
};
