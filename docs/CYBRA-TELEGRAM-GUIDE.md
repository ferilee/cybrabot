# Panduan Penggunaan CybraFeriBot di Telegram

Dokumen ini menjelaskan cara menggunakan CybraFeriBot melalui Telegram, termasuk chat AI, skill, dokumen, gambar, ekspor file, model, penggunaan di grup, dan fitur admin.

## 1. Memulai Percakapan

Buka bot `@CybraFeriBot`, lalu kirim:

```text
/start
```

Setelah itu, Cybra dapat digunakan seperti chat biasa:

```text
Jelaskan konsep trigonometri dasar.
```

```text
Bantu saya membuat pengumuman rapat wali murid.
```

```text
Bagaimana cara memperbaiki error Docker ini?
```

Cybra akan memilih skill dan model yang sesuai secara otomatis.

## 2. Gaya Jawaban

Cybra diarahkan untuk menjawab dengan gaya:

- humanis dan natural
- santai tetapi tetap sopan
- mudah dipahami
- tidak menampilkan metadata internal model pada chat biasa
- mendukung rich text Telegram

Format yang didukung:

- teks tebal dan miring
- heading dan daftar
- blok kode
- tautan
- rumus LaTeX inline dan blok

Contoh LaTeX:

```text
$$\sin^2 A + \cos^2 A = 1$$
```

## 3. Skill Otomatis

Cybra dapat memilih skill berdasarkan isi pesan.

Skill utama:

- `general-chat`: percakapan dan pertanyaan umum
- `technical-helper`: coding, debugging, deployment, dan masalah teknis
- `document-drafting`: membuat draft dokumen
- `internet-research`: mencari referensi melalui Agent Reach
- `rag-research`: menjawab menggunakan knowledge base lokal
- `penjelasan-humanis`: menjelaskan topik kompleks dengan bahasa awam dan analogi
- `grill-me`: menguji pemahaman melalui pertanyaan balik

Contoh pemicu skill humanis:

```text
Jelaskan RAG dengan bahasa awam dan kasih analogi.
```

Contoh pemicu grill-me:

```text
Uji saya tentang trigonometri dasar.
```

## 4. Command Skill Eksplisit

Gunakan command berikut untuk memilih skill secara langsung.

### Penjelasan Humanis

```text
/humanis jelaskan Docker dengan bahasa awam dan analogi
```

### Grill Me

```text
/grill uji saya tentang OOP dan inheritance
```

Kalau command dikirim tanpa topik, Cybra akan menampilkan contoh format penggunaannya.

## 5. Membaca Gambar

Kirim gambar sebagai foto atau dokumen, lalu tambahkan caption.

Contoh:

```text
Selesaikan soal matematika pada gambar ini.
```

```text
Ekstrak teks dari gambar ini.
```

```text
Analisis screenshot error ini dan jelaskan cara memperbaikinya.
```

Mode vision yang tersedia:

- ringkasan gambar
- tanya jawab gambar
- penyelesaian soal
- analisis screenshot
- OCR atau ekstraksi teks

Setelah gambar diproses, gambar tersebut menjadi dokumen aktif sehingga dapat ditanyakan kembali.

## 6. Membaca PDF, DOCX, dan XLSX

Format yang didukung:

- PDF
- DOCX
- XLSX
- JPEG
- PNG
- WEBP

Kirim file dengan caption, misalnya:

```text
Ringkas dokumen ini.
```

```text
Cari kesimpulan dan data penting dari file ini.
```

```text
Kerjakan soal yang ada dalam PDF ini.
```

Untuk PDF:

- PDF yang memiliki text layer dibaca sebagai teks
- PDF scan diproses melalui jalur vision

Ukuran file default maksimum adalah 20 MB dan dapat diubah melalui `DOCUMENT_MAX_BYTES`.

## 7. Tanya Jawab Dokumen Aktif

Setelah file berhasil diproses, gunakan pertanyaan natural:

```text
Apa kesimpulan utama dokumen ini?
```

Atau gunakan format eksplisit:

```text
dokumen: siapa pihak yang bertanggung jawab?
```

Command yang tersedia:

```text
/dokumen apa kesimpulan utama file ini?
```

```text
/dokumen
```

Command `/dokumen` tanpa pertanyaan menampilkan informasi dokumen aktif.

Untuk menghapus sesi:

```text
/dokumen_reset
```

Untuk meminta file asli dikirim kembali:

```text
/dokumen_kirim
```

## 8. Membuat File Siap Unduh

Cybra dapat membuat:

- Markdown (`.md`)
- PDF (`.pdf`)
- Word (`.docx`)

### Permintaan Langsung

```text
Buatkan PDF materi trigonometri dasar.
```

```text
Buatkan DOCX laporan kegiatan sekolah.
```

```text
Buatkan file Markdown kondisi Indonesia saat ini.
```

Saat membuat Markdown, Cybra akan menampilkan status:

```text
Siap kak, skill aktif! Tunggu sebentar yaaa ... sedang kuproses
```

Setelah selesai, file dikirim sebagai lampiran Telegram dan siap diunduh.

### Menyimpan Jawaban Terakhir

Setelah Cybra memberikan jawaban, gunakan:

```text
/simpan md
```

```text
/simpan pdf
```

```text
/simpan docx
```

Judul file dapat ditambahkan:

```text
/simpan pdf kondisi-indonesia
```

### Ekspor dari Gambar atau Dokumen

Tambahkan permintaan format pada caption:

```text
Selesaikan soal ini dan buatkan PDF.
```

```text
Ringkas dokumen ini lalu kirim sebagai DOCX.
```

```text
Baca gambar ini dan ekspor sebagai Markdown.
```

## 9. Mengganti Model AI

Hanya pemilik bot yang diizinkan dapat mengganti model runtime.

Melihat model aktif:

```text
/model
```

atau:

```text
/models
```

Mengganti model chat:

```text
/model chat gemini:gemini-2.5-flash
```

```text
/model chat minimax
```

Alias `minimax` mengarah ke:

```text
tokenrouter:MiniMax-M3
```

Mengganti semua model:

```text
/model all gemini:gemini-2.5-flash
```

Model vision sebaiknya tetap menggunakan model Gemini multimodal.

## 10. Mengecek Kuota Provider

Gunakan:

```text
/quota
```

Command ini menampilkan status provider yang digunakan model aktif.

Kuota ChatGPT Plus tidak sama dengan kuota OpenAI API. TokenRouter API key juga berbeda dengan OpenAI API key.

## 11. Penggunaan di Grup

Cybra dapat ditambahkan ke grup Telegram.

Pada konfigurasi saat ini, bot di grup hanya menerima pesan dari user yang cocok dengan:

```env
GROUP_ALLOWED_USER_ID=177517779
GROUP_ALLOWED_USERNAME=ferilee
```

Di grup, bot merespons jika:

- dipanggil menggunakan mention
- pesan membalas pesan bot
- user menjalankan command

Contoh:

```text
@CybraFeriBot jelaskan materi ini
```

## 12. Command Admin Telegram

Command admin hanya tersedia untuk pemilik bot yang diizinkan.

### Status Runtime

```text
/admin_status
```

### Mengaktifkan atau Mematikan Tool

```text
/admin_tool math on
```

```text
/admin_tool announcement off
```

Tool yang tersedia:

- `math`
- `caption`
- `announcement`
- `faq`

### Mengubah Persona

```text
/admin_persona Jawab dengan gaya santai, jelas, dan cocok untuk siswa SMK.
```

### Mengubah Template Deskripsi Bot

```text
/admin_self features
Cybra dapat membaca dokumen, memahami gambar, dan membuat file siap unduh.
```

Field yang tersedia:

- `identity`
- `features`
- `workflow`
- `improvement`

### Menambah Knowledge

```text
/admin_knowledge_add faq-sekolah
FAQ Sekolah
Sekolah buka Senin sampai Jumat pukul 07.00 sampai 15.00.
```

### Menghapus Knowledge

```text
/admin_knowledge_delete faq-sekolah
```

## 13. Mengubah Jawaban dari Panel Admin

Buka:

```text
https://domain-cybrabot/login
```

Login dengan Google. Akun `the.real.ferilee@gmail.com` otomatis menjadi `admin` dan bisa membuka `/chat`, `/dashboard`, dan `/admin`. Akun lain hanya mendapat akses ke `/chat`.

Di panel admin, session Google admin bisa langsung memanggil endpoint runtime. `ADMIN_TOKEN` tetap tersedia sebagai fallback opsional.

Bagian yang dapat diubah tanpa mengedit source code:

- persona atau instruksi gaya jawaban AI
- status pembuatan Markdown
- status pemrosesan dokumen
- pesan error AI
- pesan error dokumen
- pesan error ekspor
- template identitas dan kemampuan bot
- tool runtime
- knowledge base

Template pemrosesan dokumen mendukung variabel:

```text
{{fileName}}
```

Contoh:

```text
Siap Kak, saya sedang membaca {{fileName}}. Tunggu sebentar ya.
```

Perubahan disimpan di SQLite dan berlaku pada request berikutnya. Rebuild image dan redeploy tidak diperlukan selama database yang sama tetap digunakan.

## 14. Rich Text dan LaTeX

Cybra menggunakan Telegram Rich Message.

Format markdown sederhana:

```text
**tebal**
*miring*
`kode`
```

LaTeX inline:

```text
$x^2 + y^2$
```

LaTeX blok:

```text
$$\sin^2 A + \cos^2 A = 1$$
```

Notasi umum seperti `sin A`, `cos A`, `tan A`, dan `sqrt(x)` akan dinormalisasi sebelum dirender.

## 15. Troubleshooting

### Bot Tidak Membalas

Periksa:

- webhook masih aktif
- container berjalan
- `TELEGRAM_BOT_TOKEN` benar
- hanya satu instance webhook yang aktif
- user grup sesuai dengan allowlist

Endpoint kesehatan:

```bash
curl https://domain-cybrabot/health
```

### File Tidak Bisa Dibaca

Periksa:

- ukuran file tidak melewati batas
- mime type didukung
- model vision Gemini tersedia
- API key masih memiliki kuota

### MiniMax Tidak Berjalan

Periksa:

```env
TOKENROUTER_API_KEY=sk-...
TOKENROUTER_BASE_URL=https://api.tokenrouter.com/v1
```

Lalu pilih:

```text
/model chat minimax
```

### Respons Ganda

Pastikan mode polling tidak berjalan. Production hanya menggunakan webhook:

```text
/api/webhook
```

## 16. Ringkasan Command

| Command | Fungsi |
|---|---|
| `/start` | Memulai bot |
| `/humanis ...` | Memaksa skill penjelasan humanis |
| `/grill ...` | Memaksa skill grill-me |
| `/dokumen ...` | Bertanya tentang dokumen aktif |
| `/dokumen_reset` | Menghapus sesi dokumen |
| `/dokumen_kirim` | Mengirim ulang file aktif |
| `/simpan md` | Menyimpan jawaban terakhir sebagai Markdown |
| `/simpan pdf` | Menyimpan jawaban terakhir sebagai PDF |
| `/simpan docx` | Menyimpan jawaban terakhir sebagai DOCX |
| `/model` | Melihat atau mengganti model |
| `/models` | Melihat daftar model |
| `/quota` | Mengecek status kuota provider |
| `/admin_status` | Melihat konfigurasi runtime |
| `/admin_tool` | Mengaktifkan atau mematikan tool |
| `/admin_persona` | Mengubah instruksi persona |
| `/admin_self` | Mengubah template deskripsi bot |
| `/admin_knowledge_add` | Menambah knowledge |
| `/admin_knowledge_delete` | Menghapus knowledge |
