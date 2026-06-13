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
- **Health Check:** `http://localhost:4129/health`
- **Webhook Endpoint:** `http://localhost:4129/api/webhook`
- **Admin Config GET:** `GET /admin/config?token=...`
- **Admin Config POST:** `POST /admin/config?token=...`

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

## 🐳 Docker
- `Dockerfile` sudah disiapkan untuk image production.
- Workflow manual GHCR ada di `.github/workflows/publish-ghcr.yml`.
- Contoh compose ada di `docker-compose.example.yml`.

## 🤖 Fitur Utama
1. **Hybrid Intent Routing:** Bot secara otomatis mendeteksi apakah pesan bersifat teknis atau obrolan santai menggunakan Gemini API.
2. **Fast NLP:** Menggunakan Compromise.js untuk ekstraksi entitas tanpa beban berat.
3. **Persisten Data:** Semua interaksi disimpan ke SQLite menggunakan Drizzle ORM.
4. **Premium Dashboard:** Antarmuka web yang modern untuk memantau aktivitas bot secara real-time.

---
Dikembangkan oleh **Feri Lee** dengan ❤️ dan ⚡ Bun.
