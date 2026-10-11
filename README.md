# Web2APK Site

Situs untuk mengubah website jadi aplikasi Android (APK). Pengunjung membuat akun, mengisi alamat web, nama, warna, dan ikon, lalu **membayar dulu lewat QRIS (JayaPay, channel `qrisfast`)**. Setelah pembayaran lunas, APK dibuat otomatis dan bisa diunduh dari akun mereka.

- **Menu user:** buat APK, daftar pesanan, bayar (QR + hitung mundur + pengecekan otomatis), unduh APK, build ulang bila gagal
- **Menu admin:** ringkasan, semua pesanan (filter, cari, build ulang, setujui, batalkan), pengguna (nonaktifkan), dan **pengaturan: nama web, tagline, logo, harga, warna merek, kontak**
- Aplikasi hasil build adalah cangkang WebView native (Kotlin, tanpa dependency) yang membuka websitenya

Template Flutter lama (`webview_flutter 0.3`, Gradle 4.1, `jcenter`) sudah tidak bisa dibangun dengan toolchain sekarang, jadi diganti template Android native di `builder/android`. Konsepnya sama: satu WebView, dengan nama, alamat, warna, dan ikon yang diisi saat build.

## Cara kerja

```
Pengunjung ──► Situs (Vercel) ──► JayaPay: buat transaksi QRIS Fast
                   │                         │ status: pending → settlement
                   │  lunas ▼                │ (situs memeriksa lewat polling)
                   └──► GitHub Actions: workflow build-apk.yml
                              │ prepare.py → gradle assembleRelease → GitHub Release "order-<ID>"
                              └──► callback ke /api/build  (status: building / done / failed)
Pengunjung ◄── unduh APK lewat situs (tautan bertanda 10 menit → redirect ke file di repo private)
```

Vercel tidak punya Android SDK dan batas waktu fungsinya pendek, jadi proses build dijalankan di GitHub Actions. APK disimpan sebagai aset GitHub Release di **repo private** dan hanya bisa diunduh lewat situs setelah lunas.

## Struktur

```
api/                       fungsi serverless (8 fungsi, di bawah batas 12 paket Hobby)
  public.js  logo.js       pengaturan situs dan logo untuk halaman depan
  auth/[action].js         register, login, admin, me
  orders.js  order.js      buat/daftar pesanan; status, batal, build ulang, unduh
  icon.js  build.js        ikon untuk runner; callback status build
  admin/[action].js        settings, orders, users, stats
lib/                       jayapay.js, github.js, flow.js (alur bayar-build-unduh), users, orders, settings, ...
public/                    index.html, style.css, app.js (satu halaman, tanpa framework)
builder/
  android/                 proyek Android (Gradle + Kotlin) cangkang WebView
  scripts/prepare.py       tulis nama/alamat/warna dan buat ikon launcher
  scripts/notify.sh        lapor status build ke situs
.github/workflows/build-apk.yml
test/                      run.js (tes), mocks.js, ui-server.js (demo lokal bermock)
```

## Pasang

1. **Repo GitHub private.** Push seluruh folder ini ke repo private, cabang `main`.
2. **Token GitHub.** Buat *fine-grained personal access token* yang hanya mencakup repo itu, dengan izin **Actions: Read and write** dan **Contents: Read and write**. Ini menjadi `GH_TOKEN`.
3. **Secret di GitHub** (Settings → Secrets and variables → Actions):
   - `SITE_URL`: alamat situsmu, mis. `https://apkin.vercel.app`
   - `BUILD_SECRET`: acak minimal 16 karakter, sama persis dengan env di Vercel
   - Opsional, tanda tangan rilis tetap: `KEYSTORE_BASE64` (hasil `base64 -w0 release.jks`), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Tanpa ini APK ditandatangani kunci debug: bisa dipasang, tetapi tidak cocok untuk Google Play.
   - Pastikan di Settings → Actions → General, Workflow permissions mengizinkan Actions berjalan (workflow sudah meminta `contents: write` sendiri).
4. **Vercel.** Import repo itu. Tambahkan integrasi Upstash Redis (Storage), lalu isi environment sesuai `.env.example`: `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JAYAPAY_API_KEY`, `GH_REPO`, `GH_TOKEN`, `BUILD_SECRET`, `SITE_URL`. Deploy.
5. **Masuk admin** di `/#/admin/masuk`, buka **Pengaturan**, isi nama web, logo, dan harga.
6. **Coba satu pesanan sungguhan** dengan harga minimum (Rp 1.000) sebelum dibuka ke publik.

Uji lokal tanpa akun apa pun: `npm run demo` membuka `http://localhost:3000` dengan Redis, JayaPay, dan GitHub palsu (admin `bos` / `rahasia-admin-123`). Atur pembayaran palsu lewat `/__mock?status=settlement`, `/__mock?advance=10000`, dan `/__mock?release=<ID pesanan>`. `npm test` menjalankan tes otomatis.

## Pembayaran (JayaPay qrisfast)

Situs memanggil `POST /api/pay/create` dengan `{ amount, channel: "qrisfast", reference: <ID pesanan> }`, menampilkan `qr_url` dan `pay_url`, lalu memeriksa `GET /api/pay/status?id=` tiap beberapa detik selama halaman pesanan terbuka. Status `settlement` memicu build, tepat satu kali walau banyak polling bersamaan. `expire` dan `cancel` menutup pesanan.

- **Harga dikunci** saat pesanan dibuat; mengubah harga di admin hanya berlaku untuk pesanan baru. Batas JayaPay: Rp 1.000 sampai Rp 10.000.000.
- **Fee** QRIS Fast diatur di dashboard JayaPay (Pengaturan → Biaya QRIS). Total yang dibayar pembeli diambil dari respons JayaPay dan ditampilkan apa adanya.
- Nominal atau referensi yang tidak cocok saat lunas membuat pesanan berstatus **Perlu diperiksa**; tidak ada build sampai admin menyetujui.
- Satu user maksimal 3 pesanan belum dibayar sekaligus dan 10 pesanan per jam.

## Keterbatasan dan hal yang perlu dicek

- **Build Android belum pernah dijalankan** di lingkungan tempat proyek ini dibuat (tidak ada Android SDK atau akses jaringan). Alur Node.js dan tampilan sudah diuji (`npm test`, uji browser), `prepare.py` diuji terpisah, tetapi file Gradle/Kotlin dan workflow baru terbukti saat dijalankan pertama kali di GitHub Actions. Jalankan workflow manual sekali (Actions → Build APK → Run workflow, dengan ID 16 hex huruf besar, mis. `ABCDEF0123456789`) dan perbaiki bila ada galat versi.
- **Respons JayaPay** ditulis berdasarkan halaman docs (field `id`, `total`, `qr_url`, `pay_url`, `expiry`, `status`). Respons contoh di docs terpotong, jadi bila ada field yang berbeda, sesuaikan `lib/jayapay.js`. `expiry` dibaca sebagai WIB (UTC+7) sesuai contoh.
- **Tidak ada webhook** (tidak ada di docs), jadi pelunasan baru terdeteksi saat halaman pesanan terbuka atau admin menekan Segarkan. Pembeli yang menutup halaman sebelum pelunasan tercatat akan melihat status terbarunya saat membuka pesanan lagi.
- **Refund** tidak tersedia di API JayaPay yang terdokumentasi. Bila build gagal terus, admin menanganinya manual.
- **Penyalahgunaan:** siapa pun bisa membungkus situs apa pun menjadi APK, termasuk situs penipuan. Build berjalan otomatis setelah bayar. Pantau menu Pesanan, cantumkan syarat penggunaan, dan pertimbangkan peninjauan manual bila risikonya tinggi.
- **Vercel Hobby** hanya untuk penggunaan non-komersial. Layanan berbayar seperti ini membutuhkan paket Pro.
- Build GitHub Actions memakai menit gratis repo private (2.000 menit per bulan untuk akun gratis). Satu build sekitar 3 sampai 6 menit.
- APK memakai `usesCleartextTraffic=false`, jadi hanya situs HTTPS yang didukung.
- Login Google di dalam WebView biasanya diblokir oleh Google, sehingga situs yang hanya menyediakan "Masuk dengan Google" tidak cocok.

## Keamanan

- Password di-hash dengan scrypt; token sesi bertanda HMAC (user 30 hari, admin 12 jam, dicabut saat password admin diganti); percobaan login gagal dibatasi per IP.
- Akses antar pengguna diperiksa di server; user tidak bisa melihat pesanan orang lain atau memanggil endpoint admin.
- Semua input pesanan divalidasi di server dan diperiksa ulang di runner; input workflow hanya lewat variabel lingkungan, tidak pernah disisipkan ke perintah shell.
- Ikon pesanan hanya bisa diambil runner dengan tautan bertanda 2 jam; unduhan APK memakai tautan bertanda 10 menit lalu redirect ke URL GitHub berumur pendek.
- Callback build dilindungi `BUILD_SECRET` (perbandingan waktu-konstan).
- Nama kunci Redis berawalan `w2a:`. Token sesi disimpan di `localStorage` browser.
