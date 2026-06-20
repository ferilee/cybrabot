# Checklist Tuning CybraFeriBot

Dokumen ini dipakai untuk tuning `CybraFeriBot` secara terukur, bukan berdasarkan feeling.

## 1. Tujuan Tuning

Sebelum mengubah apa pun, tetapkan satu target utama untuk satu siklus tuning:

- kualitas jawaban
- ketepatan skill routing
- biaya inferensi
- latency
- stabilitas fallback
- konsistensi persona

Jangan tuning semua hal sekaligus.

## 2. Titik Kontrol Utama

### Model dan provider

- [lib/ai.ts](/home/ferilee/DEV/cybraferibot/lib/ai.ts)
- [lib/admin-config.ts](/home/ferilee/DEV/cybraferibot/lib/admin-config.ts)

Parameter penting:

- `GEMINI_INTENT_MODEL`
- `GEMINI_MODEL`
- `GEMINI_DOCUMENT_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `OPENAI_FALLBACK_MODEL`
- `OPENAI_COMPAT_FALLBACK_MODEL`
- `TOKENROUTER_FALLBACK_MODEL`

Runtime model yang bisa diubah dari admin config:

- `models.intent`
- `models.chat`
- `models.document`

### Persona dan template jawaban

- [lib/ai.ts](/home/ferilee/DEV/cybraferibot/lib/ai.ts)
- [lib/admin-config.ts](/home/ferilee/DEV/cybraferibot/lib/admin-config.ts)

Titik tuning:

- `casualInstructions`
- `technicalInstructions`
- `documentDraftInstructions`
- `personaOverride`
- `responseTemplates`

### Skill routing

- [lib/web-skills.ts](/home/ferilee/DEV/cybraferibot/lib/web-skills.ts)
- [skills](/home/ferilee/DEV/cybraferibot/skills)

Titik tuning:

- `title`
- `description`
- `triggers`
- `modelHint`
- isi `SKILL.md`

### Preferensi user

- [lib/preferences.ts](/home/ferilee/DEV/cybraferibot/lib/preferences.ts)

Titik tuning:

- `tone`
- `answerLength`
- `preferredName`

### Knowledge

- [lib/knowledge.ts](/home/ferilee/DEV/cybraferibot/lib/knowledge.ts)
- [knowledge](/home/ferilee/DEV/cybraferibot/knowledge)

### Evaluasi dan observability

- [api/index.ts](/home/ferilee/DEV/cybraferibot/api/index.ts)
- [lib/observability.ts](/home/ferilee/DEV/cybraferibot/lib/observability.ts)
- `/admin`
- `/dashboard`

## 3. Urutan Tuning yang Disarankan

1. pilih model intent dan chat
2. rapikan persona/prompt
3. rapikan skill boundary dan trigger
4. tambah knowledge yang relevan
5. audit fallback, biaya, dan latency

## 4. Baseline Prompt

Gunakan prompt yang sama di setiap siklus tuning.

| ID | Prompt | Target Uji |
| --- | --- | --- |
| B1 | Jelaskan trigonometri kelas 10 secara ringkas. | kualitas jawaban umum |
| B2 | Buat materi ajar trigonometri lengkap dengan tabel dan rumus. | struktur + LaTeX + tabel |
| B3 | Hitung dan jelaskan $$\\int_0^\\infty e^{-x^2} dx$$ | akurasi matematika |
| B4 | Buat pengumuman resmi untuk wali murid tentang jadwal asesmen. | drafting formal |
| B5 | Ringkas dokumen ini menjadi 5 poin utama. | dokumen |
| B6 | Cari informasi di web tentang kurikulum merdeka terbaru. | route web/internet |
| B7 | Siapa Mas Feri Lee? | knowledge/persona |
| B8 | Panggil aku Feri dan jawab lebih formal. | preferensi user |
| B9 | Saya butuh jawaban lebih detail tentang limit fungsi. | preferensi panjang jawaban |
| B10 | Tolong bantu bikin draft proposal kegiatan sekolah. | drafting panjang |
| B11 | Tolong bantu debugging error TypeScript ini. | skill teknis |
| B12 | Saya ingin riset singkat tentang Agent Reach. | skill riset |

## 5. Tabel Evaluasi

Gunakan tabel ini setiap selesai satu siklus tuning.

| Prompt ID | Skill Terpilih | Model | Fallback | Latency | Hasil | Catatan |
| --- | --- | --- | --- | --- | --- | --- |
| B1 |  |  |  |  |  |  |
| B2 |  |  |  |  |  |  |
| B3 |  |  |  |  |  |  |
| B4 |  |  |  |  |  |  |
| B5 |  |  |  |  |  |  |
| B6 |  |  |  |  |  |  |
| B7 |  |  |  |  |  |  |
| B8 |  |  |  |  |  |  |
| B9 |  |  |  |  |  |  |
| B10 |  |  |  |  |  |  |
| B11 |  |  |  |  |  |  |
| B12 |  |  |  |  |  |  |

## 6. Checklist per Area

### A. Model

- [ ] `intent model` cepat dan stabil
- [ ] `chat model` cukup kuat untuk jawaban utama
- [ ] `document model` cocok untuk drafting/ringkasan
- [ ] fallback aktif hanya saat perlu
- [ ] biaya model masih masuk akal

### B. Prompt / Persona

- [ ] casual tidak terlalu bercanda
- [ ] technical tetap langsung ke solusi
- [ ] instruksi LaTeX konsisten
- [ ] format heading/bullet tetap rapi
- [ ] tidak ada HTML mentah yang lolos ke jawaban model

### C. Skill Routing

- [ ] skill tidak overlap terlalu lebar
- [ ] trigger cukup spesifik
- [ ] skill yang tepat menang pada prompt ambigu
- [ ] `Auto Skill` tidak terlalu sering jatuh ke general chat

### D. Knowledge

- [ ] informasi identitas Cybra akurat
- [ ] informasi pengembang akurat
- [ ] FAQ inti sudah masuk knowledge
- [ ] materi domain penting sudah tersedia
- [ ] tidak ada knowledge usang yang menyesatkan

### E. Preferensi User

- [ ] tone formal/santai benar-benar terasa
- [ ] panjang jawaban berubah sesuai preferensi
- [ ] preferred name dipakai konsisten
- [ ] reset preferensi dilakukan saat perlu uji ulang

### F. Web Chat dan Telegram

- [ ] web chat menampilkan markdown dengan benar
- [ ] LaTeX tampil benar di web
- [ ] Telegram rich message tetap aman
- [ ] tabel tidak rusak di Telegram fallback
- [ ] metadata model/skill tampil sesuai hasil aktual

## 7. Langkah Operasional per Siklus

1. tetapkan target tuning
2. catat konfigurasi awal
3. jalankan baseline prompt
4. simpan hasil evaluasi awal
5. ubah satu variabel saja
6. jalankan baseline prompt lagi
7. bandingkan hasil
8. cek `/admin` dan `/dashboard`
9. putuskan: pertahankan, revisi, atau rollback

## 8. Metrik yang Perlu Dipantau

- skill yang dipilih
- model yang dipakai
- fallback rate
- error provider
- latency rata-rata
- kualitas struktur jawaban
- akurasi jawaban domain
- konsistensi persona

## 9. Sinyal Masalah dan Arah Perbaikan

### Jika skill sering salah pilih

Periksa:

- [lib/web-skills.ts](/home/ferilee/DEV/cybraferibot/lib/web-skills.ts)
- trigger skill
- deskripsi skill

Perbaikan:

- kurangi overlap trigger
- perjelas description
- tambah trigger yang lebih literal

### Jika jawaban bagus tapi lambat

Periksa:

- model `chat`
- provider fallback

Perbaikan:

- turunkan model utama
- pakai model lebih kecil untuk intent
- audit apakah prompt/history terlalu panjang

### Jika jawaban cepat tapi dangkal

Periksa:

- `GEMINI_MODEL`
- knowledge yang terpasang
- `answerLength`

Perbaikan:

- naikkan model utama
- tambah knowledge
- ubah preferensi/detail instruction

### Jika fallback terlalu sering

Periksa:

- status provider
- rate limit
- model yang dipilih

Perbaikan:

- ganti fallback model
- tambahkan provider cadangan
- audit log error

## 10. Catatan Siklus

### Siklus Tuning

- Tanggal:
- Target:
- Konfigurasi awal:
- Perubahan:
- Hasil:
- Keputusan:
