# 🚀 CybraFeriBot (Node/Bun Version)

**CybraFeriBot** adalah bot Telegram *Hybrid* berperforma tinggi yang dibangun menggunakan **Bun runtime** dan **Hono framework**, dirancang untuk integrasi AI yang cepat dan manajemen data yang efisien menggunakan Drizzle ORM.

## 🛠️ Tech Stack
- **Runtime:** [Bun](https://bun.sh)
- **Web Framework:** [Hono](https://hono.dev)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team)
- **Database:** SQLite (Native via Bun)
- **NLP:** [Compromise.js](https://compromise.cool)
- **AI SDK:** [Google Gen AI SDK](https://ai.google.dev/gemini-api/docs/quickstart)
- **Bot Library:** [grammY](https://grammy.dev)

## 📁 Struktur Proyek
- `/api`: Endpoint Hono & Webhook Telegram.
- `/bot`: Logika utama bot Telegram.
- `/db`: Schema dan konfigurasi database Drizzle.
- `/lib`: Utilitas AI dan NLP.
- `index.ts`: Entry point aplikasi.

## 🚀 Cara Menjalankan

### 1. Persiapan Environment
Salin file `.env.example` menjadi `.env` dan isi token yang diperlukan:
```bash
cp .env.example .env
```
Isi variabel berikut:
- `TELEGRAM_BOT_TOKEN`: Dapatkan dari [@BotFather](https://t.me/BotFather).
- `GEMINI_API_KEY`: API key untuk Gemini API.
- `GEMINI_MODEL` *(opsional)*: default `gemini-2.5-flash`.
- `GEMINI_INTENT_MODEL` *(opsional)*: default `gemini-2.5-flash-lite`.
- `GEMINI_DOCUMENT_MODEL` *(opsional)*: model untuk ringkasan PDF/gambar dan tanya jawab dokumen.
- `DOCUMENT_MAX_BYTES` *(opsional)*: batas ukuran file yang diproses bot, default `20971520` (20MB).
- `ADMIN_TOKEN` *(opsional)*: token untuk mengubah konfigurasi admin runtime via API.

### 2. Instalasi Dependensi
```bash
bun install
```

### 3. Migrasi Database
Gunakan Drizzle Kit untuk menyiapkan tabel database:
```bash
bun run db:push
```

### 4. Jalankan Aplikasi
Aplikasi akan berjalan di port **4129**.
```bash
bun run dev
```

Untuk mode production tanpa hot reload:
```bash
bun run start
```

## 🌐 Dashboard & API
Setelah dijalankan, Anda dapat mengakses:
- **Dashboard:** `http://localhost:4129/` (Visualisasi statistik bot)
- **Admin Panel:** `http://localhost:4129/admin` (Kelola runtime config, knowledge, dan reset preferensi user)
- **Health Check:** `http://localhost:4129/health`
- **Webhook Endpoint:** `http://localhost:4129/api/webhook`
- **Admin Config GET:** `GET /admin/config?token=...`
- **Admin Config POST:** `POST /admin/config?token=...`
- **Admin Insights:** `GET /admin/insights?token=...`
- **Knowledge List:** `GET /admin/knowledge?token=...`
- **Knowledge Upsert:** `POST /admin/knowledge?token=...`
- **Knowledge Delete:** `DELETE /admin/knowledge/:id?token=...`
- **Reset User Preferences:** `POST /admin/preferences/reset?token=...`

Contoh update konfigurasi admin:
```bash
curl -X POST "http://localhost:4129/admin/config?token=ADMIN_TOKEN_ANDA" \
  -H "Content-Type: application/json" \
  -d '{
    "enabledTools": {
      "math": true,
      "caption": true,
      "announcement": false,
      "faq": true
    },
    "personaOverride": "Jawablah dengan nada lebih profesional untuk konteks sekolah."
  }'
```

Panel admin web menggunakan endpoint yang sama. Buka `/admin`, isi `ADMIN_TOKEN`, lalu lakukan perubahan dari browser.

Contoh tambah/update knowledge:
```bash
curl -X POST "http://localhost:4129/admin/knowledge?token=ADMIN_TOKEN_ANDA" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "faq-biaya-sekolah",
    "title": "FAQ Biaya Sekolah",
    "content": "Informasi biaya sekolah dapat dijelaskan per komponen: SPP, kegiatan, dan seragam."
  }'
```

Contoh hapus knowledge:
```bash
curl -X DELETE "http://localhost:4129/admin/knowledge/faq-biaya-sekolah?token=ADMIN_TOKEN_ANDA"
```

Contoh reset preferensi user:
```bash
curl -X POST "http://localhost:4129/admin/preferences/reset?token=ADMIN_TOKEN_ANDA" \
  -H "Content-Type: application/json" \
  -d '{"userId": 123456789}'
```

## 🐳 Docker
- `Dockerfile` sudah disiapkan untuk image production.
- Workflow manual GHCR ada di `.github/workflows/publish-ghcr.yml`.
- Contoh compose ada di `docker-compose.example.yml`.

## 🤖 Fitur Utama
1. **Hybrid Intent Routing:** Bot secara otomatis mendeteksi apakah pesan bersifat teknis atau obrolan santai menggunakan Gemini API.
2. **Fast NLP:** Menggunakan Compromise.js untuk ekstraksi entitas tanpa beban berat.
3. **Persisten Data:** Semua interaksi disimpan ke SQLite menggunakan Drizzle ORM.
4. **Premium Dashboard:** Antarmuka web yang modern untuk memantau aktivitas bot secara real-time.
5. **Document AI:** Bot bisa menerima <b>PDF</b> atau <b>gambar</b>, membuat ringkasan, lalu menjawab pertanyaan tentang dokumen aktif.

## 📄 Fitur Dokumen
Alur pakainya:
1. Kirim file <b>PDF</b> atau <b>gambar</b> ke bot.
2. Bot akan membuat ringkasan dan menyimpannya sebagai <b>dokumen aktif</b>.
3. Tanya isi dokumen dengan salah satu format:
   - `dokumen: apa kesimpulan utamanya?`
   - `/dokumen siapa tokoh utama di file ini?`
4. Untuk menghapus dokumen aktif:
   - `/dokumen_reset`

Catatan:
- Saat ini bot hanya memproses PDF dan gambar.
- Jawaban dokumen diambil dari file yang diunggah ke Gemini Files API.
- Referensi file di Gemini bersifat sementara, jadi bila sudah lama, unggah ulang dokumennya.

---
Dikembangkan oleh **Feri Lee** dengan ❤️ dan ⚡ Bun.
