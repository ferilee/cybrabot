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
- `OPENAI_API_KEY` *(opsional)*: dipakai untuk provider OpenAI-compatible seperti TokenRouter/MiniMax.
- `OPENAI_BASE_URL` *(opsional)*: base URL provider OpenAI-compatible, default `https://api.tokenrouter.com/v1`.
- `DOCUMENT_MAX_BYTES` *(opsional)*: batas ukuran file yang diproses bot, default `20971520` (20MB).
- `ADMIN_TOKEN` *(opsional)*: token untuk mengubah konfigurasi admin runtime via API.
- `GROUP_ALLOWED_USER_ID` *(opsional)*: hanya user ini yang boleh memanggil bot di grup, default `177517779`.
- `GROUP_ALLOWED_USERNAME` *(opsional)*: username Telegram yang dipasangkan dengan `GROUP_ALLOWED_USER_ID`, default `ferilee`.

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

### Format model runtime
Anda bisa mengganti model runtime lewat Telegram dengan prefiks provider:
- `gemini:gemini-2.5-flash`
- `gemini:gemini-2.5-pro`
- `tokenrouter:MiniMax-M3`

Contoh:
```text
/model chat tokenrouter:MiniMax-M3
/model intent gemini:gemini-2.5-flash-lite
/model document gemini:gemini-2.5-flash
/model minimax
/models
```

Jika prefiks provider tidak ditulis, bot menganggap model itu milik Gemini.

Di panel admin, Anda juga bisa mengubah template jawaban meta bot seperti:
- identitas CybraFeriBot
- daftar fitur
- cara kerja bot
- arah peningkatan kemampuan bot

## 📲 Update Bot via Telegram
CybraFeriBot sekarang juga bisa menerima pembaruan <b>runtime</b> langsung dari Telegram, tetapi hanya dari pemilik bot yang diizinkan:
- `user_id: 177517779`
- `username: @ferilee`

Batasannya sengaja ketat:
- bisa mengubah <b>runtime config</b>, <b>persona</b>, <b>template jawaban meta</b>, dan <b>knowledge base</b>
- tidak bisa menjalankan <b>arbitrary code execution</b> atau memodifikasi source code langsung dari chat

Perintah yang tersedia:
- `/admin_status`
- `/admin_tool [math|caption|announcement|faq] [on|off]`
- `/admin_persona isi persona baru`
- `/admin_self [identity|features|workflow|improvement]` lalu isi baru di baris berikutnya
- `/admin_knowledge_add` lalu isi `id`, `judul`, dan `konten` dalam format multiline
- `/admin_knowledge_delete id-dokumen`

Contoh:
```text
/admin_tool announcement off
```

```text
/admin_persona Jawablah dengan nada formal, ringkas, dan cocok untuk konteks sekolah.
```

```text
/admin_self features
CybraFeriBot dapat membaca PDF dan gambar, meringkas dokumen, menjawab pertanyaan tentang dokumen, dan membuat file PDF atau DOCX.
```

```text
/admin_knowledge_add faq-jam-operasional
FAQ Jam Operasional
Sekolah buka Senin sampai Jumat pukul 07.00-15.00.
```

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
5. **Document AI:** Bot bisa menerima <b>PDF</b>, <b>gambar</b>, <b>DOCX</b>, atau <b>XLSX</b>, lalu menjawab pertanyaan tentang dokumen aktif.
6. **Document Export:** Bot bisa membuat file <b>PDF</b> atau <b>DOCX</b> dari permintaan user dan mengirimkannya kembali ke Telegram.
7. **Telegram Rich Messages:** Jawaban bot dikirim memakai API rich message Telegram terbaru, dengan fallback ke teks biasa bila perlu.

## 📄 Fitur Dokumen
Alur pakainya:
1. Kirim file <b>PDF</b>, <b>gambar</b>, <b>DOCX</b>, atau <b>XLSX</b> ke bot.
2. Jika Anda menulis caption atau prompt saat upload, bot akan mengikuti instruksi itu berdasarkan isi file. Kalau tidak ada prompt, bot akan membuat ringkasan.
3. Bot menyimpan hasilnya sebagai <b>dokumen aktif</b>.
4. Tanya isi dokumen dengan salah satu format:
   - `dokumen: apa kesimpulan utamanya?`
   - `/dokumen siapa tokoh utama di file ini?`
   - atau pertanyaan natural yang jelas merujuk ke dokumen aktif, misalnya: `tolong baca dan ringkas PDF ini`
   - untuk meminta file aslinya kembali, gunakan `/dokumen_kirim` atau kalimat seperti `kirim file itu`
5. Untuk menghapus dokumen aktif:
   - `/dokumen_reset`

Catatan:
- PDF dan gambar diproses lewat Gemini Files API.
- DOCX dan XLSX diekstrak teksnya terlebih dahulu lalu dijawab atau diringkas.
- Referensi file di Gemini bersifat sementara, jadi bila sudah lama, unggah ulang dokumennya.

## 🧾 Ekspor PDF / DOCX
Contoh permintaan:
- `buatkan PDF surat resmi undangan rapat wali murid`
- `tolong buat docx proposal kegiatan class meeting`
- `buatkan file word notulen rapat guru dengan format rapi`

Cara kerja:
1. Bot menyusun isi dokumen dengan Gemini.
2. Bot mengubah hasilnya menjadi file <b>PDF</b> atau <b>DOCX</b>.
3. Bot mengirim file tersebut kembali ke chat Telegram.

## 👥 Penggunaan di Grup Telegram
CybraFeriBot bisa ditambahkan ke grup. Secara default, implementasi bot ini sekarang hanya akan merespons di grup jika <b>pengirimnya adalah user yang diizinkan</b> dan salah satu kondisi berikut terpenuhi:
- bot di-mention
- pesan merupakan reply ke pesan bot
- user memakai command

Default user yang diizinkan:
- `user_id: 177517779`
- `username: @ferilee`

Tujuannya agar bot tidak menanggapi semua percakapan grup, tidak dipakai sembarang anggota, dan tidak boros token.

---
Dikembangkan oleh **Feri Lee** dengan ❤️ dan ⚡ Bun.
