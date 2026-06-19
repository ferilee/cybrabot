---
name: penjelasan-humanis
description: Explain complex technical topics in plain, humanistic Indonesian language while keeping technical terms intact. Use when the user asks for explanation in "bahasa awam", "bahasa humanis", "buku referensi bukan textbook", or wants friendly accessible explanations with analogies. Triggers include phrases like "jelaskan dengan bahasa awam", "penjelasan humanis", "gaya ngobrol", "bukan kayak textbook", or requests for explanations with analogies and everyday-life comparisons. Keep technical terms (LLM, MCP, RAG, system prompt, agentic, etc.) intact — don't translate or simplify them.
version: 1.0.0
author: PertamaBot (untuk bangHasan)
tags: [explanation, writing, indonesian, education, analogies]
---

# Penjelasan Humanis — Skill untuk Menjelaskan Topik Kompleks dengan Gaya Gaul tapi Tetap Teknis

Skill ini dipakai ketika user minta penjelasan **topik teknis/kompleks** dengan gaya:
- 🎯 Bahasa awam / bahasa manusia — kayak ngobrol, bukan kayak textbook
- 💬 Istilah teknis **tetap dipertahankan apa adanya** (LLM, MCP, RAG, system prompt, agentic, dsb)
- 🌐 Humanis — ada warmth, ada personality, ga kaku
- 📚 Buku referensi style — gampang discan, ada analogi, ada TL;DR

---

## Kapan Skill Ini Auto-Load?

Skill ini akan auto-terpanggil kalau user request mengandung cue-cue berikut:

### Trigger phrases (Indonesia):
- "jelaskan dengan bahasa awam"
- "bahasa user awam" / "bahasa awam saja"
- "penjelasan humanis" / "gaya humanis"
- "bukan kayak textbook" / "bukan kayak buku teks"
- "gaya ngobrol" / "kayak ngobrol aja"
- "ada analogi nya gak?" / "kasih analogi"
- "buku referensi bukan textbook"
- "simple aja" / "gampang dicerna"

### Trigger phrases (English, kalau user campur):
- "explain like I'm 5"
- "plain language explanation"
- "ELI5"
- "with analogies"
- "humanistic tone"
- "not too technical"

### Kalau ragu, tanya klarifikasi:
> "Mau yang bahasa awam (dengan analogi) atau yang teknis (dengan istilah lengkap)? Dua-duanya bisa, mau pilih yang mana?"

---

## 4 Prinsip Utama (NON-NEGOTIABLE)

### Prinsip 1: 🎯 Analogi Kehidupan Nyata — WAJIB

Selalu buka atau sisipkan **minimal 1 analogi yang relate** sama kehidupan sehari-hari. Tujuannya: bikin konsep abstrak jadi konkret.

**Pattern yang bagus:**
- Konsep memory/AI → "karyawan baru yang super pintar tapi amnesia"
- Konsep API → "pelayan restoran — kamu cuma perlu tau menu & cara pesan"
- Konsep Docker → "kontainer pengiriman — barangmu (aplikasi) ditaro di kontainer"
- Konsep Git → "mesin waktu buat kode"
- Konsep prompt → "buku panduan / instruksi kerja"
- Kontex file → "buku catatan / onboarding kit"

**Analogi harus:**
- ✅ Relate sama pengalaman umum (rumah, kantor, sekolah, jalan-jalan)
- ✅ Ngga terlalu jauh / forcing
- ✅ Bisa dibayangin (visual)
- ❌ Jangan terlalu abstrak juga

---

### Prinsip 2: 💬 Istilah Teknis Tetap Dipertahankan — INI KUNCI

**JANGAN** terjemahkan atau "simplifikasi" istilah teknis ke padanan bahasa Indonesia. Justru dengan mempertahankan istilah asli, user **belajar kosakata baru** sambil dapat penjelasan.

**Contoh BENAR:**
- LLM → tetap "LLM" (Large Language Model) — boleh jelasin singkat setelahnya
- MCP → tetap "MCP" (Model Context Protocol)
- RAG → tetap "RAG" (Retrieval-Augmented Generation)
- system prompt → tetap "system prompt"
- agentic → tetap "agentic"
- deployment → tetap "deployment"
- front matter → tetap "front matter"
- context window → tetap "context window"

**Contoh SALAH:**
- ❌ LLM → "model bahasa gede"
- ❌ deployment → "penerapan"
- ❌ agentic → "mandiri"
- ❌ prompt → "perintah"

**Bold atau italic** istilah pertama kali muncul. Kasih konteks 1 kalimat singkat kalau bener-bener asing.

---

### Prinsip 3: 🌐 Bahasa Humanis / Ngobrol — Bukan Formal Kaku

- Pake **"kamu/lo/kita"** — bukan "Anda" / formal kaku
- Emoji secukupnya buat ekspresi (1-2 per section, jangan lebay)
- Boleh lucu / garing, **maks 1-2x** per penjelasan
- Tiap section ada **transisi smooth**
- Penutup reflektif / filosofis dikit boleh
- Hindari: "Berdasarkan analisis yang mendalam...", "Dapat disimpulkan bahwa...", "Semoga bermanfaat"

**Gaya bahasa yang oke:**
- "Jadi intinya gini..."
- "Nah, ini yang menarik..."
- "Kebayang kan?"
- "Nah loh, udah mirip"
- "Yang bikin kaget..."
- "By the way..."

---

### Prinsip 4: 📚 Buku Referensi, Bukan Textbook

- ✅ Gampang discan (heading jelas, table, bullet)
- ✅ Ada analogi di tiap konsep baru
- ✅ Contoh konkret / kode snippet kalau perlu
- ✅ TL;DR / ringkasan di akhir
- ✅ Referensi / link lanjutan buat yang mau dive-in
- ✅ Panjang ideal: 1.500-3.000 kata (lebih kalau topik berat)

**Bukan kayak textbook:**
- ❌ Paragraf super panjang tanpa visual
- ❌ Bahasa akademis banget
- ❌ Gak ada analogi
- ❌ Gak ada TL;DR
- ❌ Referensi disembunyiin di footnote

---

## Step-by-Step Process

### Step 1: Pahami Sumber
- Fetch / baca konten asli (URL, file, atau context yang dikasih user)
- Identifikasi konsep inti, terminology, struktur
- Note bagian yang **butuh analogi**
- Note istilah teknis yang harus **dipertahankan**
- Kalau ada kode, pahami logikanya

### Step 2: Outline Sebelum Nulis
- Bikin kerangka section (heading + sub-heading)
- Tentukan di mana analogi masuk (tiap section penting)
- Identifikasi istilah teknis yang perlu di-bold pertama kali
- Plan output: panjang, format file, nama file

### Step 3: Tulis dengan Hook di Awal
- **Paragraf pertama = hook + analogi utama**
- Taruh 1 analogi kuat di awal yang jadi "peta" buat seluruh penjelasan
- Contoh: "Bayangin lo punya karyawan baru yang super pintar..."

### Step 4: Section-by-Section, Terstruktur

Tiap section fokus 1 konsep. Di dalam section:

```
## [Nama Section]

### Analogi / Konteks
[Analogi kehidupan nyata — relateable]

### Definisi / Penjelasan
[Penjelasan ringkas dengan istilah teknis bold/italic]

### Contoh
[Contoh konkret / kode / skenario]

### Catatan / Nuance
[Insight tambahan, pitfall, atau hal yang sering kelewat]
```

### Step 5: Pertahankan Istilah Teknis
- **Bold** istilah pertama kali muncul
- Kasih konteks 1 kalimat (misal: "MCP (Model Context Protocol)...")
- **Jangan** terjemahkan
- Kalau terlalu banyak istilah asing, bisa bikin **mini-glossary** di akhir

### Step 6: Tutup dengan Refleksi & TL;DR
- **TL;DR** wajib di akhir — 1 paragraf atau 3 poin
- **Referensi** / link lanjutan
- Penutup reflektif / filosofis yang relate sama user
- Boleh ada CTA halus (misal: "Kalau mau dive-in lebih jauh...")

### Step 7: Format & Kirim
- Format markdown dengan struktur jelas (## / ###)
- Blockquote buat analogi kunci
- Table buat perbandingan / ringkasan
- Code block buat contoh kode/teknis
- Save ke `/tmp/<nama-topik>-penjelasan.md`
- Kirim via `MEDIA:/tmp/<nama-topik>-penjelasan.md`

---

## Output Format Standar

Hasil akhir SELALU:
- 📄 **File markdown** (`.md`)
- 📂 Path: `/tmp/<topik>-penjelasan.md` (atau topic-relevant)
- 📤 Dikirim via `MEDIA:/tmp/...` ke chat
- 📏 Panjang: 1.500-3.000 kata (idealnya), 800-1.500 (topik ringan), 3.000-5.000 (topik berat)
- 🧱 Struktur wajib:
  1. Opening dengan hook + analogi
  2. Sections terstruktur (tiap section ada analogi)
  3. TL;DR / intisari
  4. Referensi / link lanjutan
- 🎨 Visual: heading, blockquote, table, list, code block secukupnya

### Response Singkat Setelah Kirim File

Setelah kirim file, boleh tambahin ringkasan singkat 2-4 baris:
```
✅ Beres! Aku pake skill penjelasan-humanis.
- Highlight 1
- Highlight 2
- Highlight 3

Mau dive-in lebih dalam di bagian tertentu? Atau ada topik lain yang mau dijelasin? 🎯
```

---

## Template Opening Hook (Pilih Sesuai Topik)

| Topik | Hook |
|---|---|
| Memory/AI persistence | "Bayangin lo punya asisten AI pribadi yang super pintar. Tapi tiap kali buka chat baru, dia **lupa semuanya**..." |
| API | "API itu kayak pelayan restoran. Lo cuma perlu tau menu & cara pesen, gak perlu tau dapur..." |
| Docker/Container | "Docker itu kayak kontainer pengiriman. Barang lo (aplikasi) ditaro di kontainer yang bisa diangkut ke mana aja..." |
| Git/Version Control | "Git itu kayak mesin waktu buat kode. Bisa balik ke versi sebelumnya kapan aja, dan liat siapa yang ngubah apa..." |
| System Prompt | "System prompt itu kayak 'buku panduan karyawan' yang dibaca AI sebelum mulai kerja..." |
| Context File | "Context file itu kayak 'onboarding kit' buat karyawan baru — biar dia langsung ngerti project, role, sama tools-nya..." |
| Machine Learning | "ML itu kayak ngajar anak kecil. Lo kasih banyak contoh, dia liat polanya, lama-lama dia bisa nebak sendiri..." |
| Database | "Database itu kayak lemari arsip yang sangat terstruktur. Tiap laci punya kategori, tiap file punya lokasi..." |
| Encryption | "Encryption itu kayakamplop rahasia. Isinya cuma bisa dibaca sama orang yang punya kunci..." |
| Neural Network | "Neural network itu kayak otak tiruan — terdiri dari neuron-neuron yang saling kirim sinyal..." |

**Atau bikin hook sendiri** yang lebih relate sama konteks user.

---

## Pitfalls — Yang HARUS Dihindari

| ❌ Jangan | ✅ Lebih Baik |
|---|---|
| Terlalu panjang (>5000 kata untuk 1 topik) | Pecah jadi 2-3 file kalau emang berat |
| Menerjemahkan istilah teknis | Biarkan istilah asli, kasih konteks |
| Bahasa formal / kaku | Bahasa ngobrol, santai, friendly |
| Analogi yang terlalu jauh | Analogi yang relate sama kehidupan umum |
| Skip TL;DR | Wajib ada TL;DR / intisari |
| Condescending ke user | User awam ≠ user bodoh — hormati |
| Lebay emoji | 1-2 per section cukup, jangan 5+ |
| Heading tanpa isi | Tiap heading harus ada minimal 1 paragraf |
| Langsung to-the-point tanpa konteks | Selalu buka dengan konteks / analogi dulu |
| Copy-paste struktur textbook | Bikin flow yang lebih organik |

---

## Contoh Response Flow

```
User: "Jelasin [topik X] dong, tapi bahasa awam ya"
↓
Skill penjelasan-humanis loaded
↓
Fetch konten / baca konsep
↓
Outline + identify istilah teknis yang perlu dijaga
↓
Tulis markdown:
  - Hook + analogi di paragraf pertama
  - Sections terstruktur, tiap section ada analogi
  - TL;DR di akhir
  - Referensi / link
↓
Save to /tmp/<topik>-penjelasan.md
↓
Kirim via MEDIA:/tmp/<topik>-penjelasan.md
↓
Ringkas 2-4 baris di chat + offer follow-up
```

---

## Contoh Output Bagus (Referensi Internal)

Lihat `/tmp/prompts-md-penjelasan.md` — itu contoh **sempurna** output dari skill ini. Lihat:
- ✅ Hook opening dengan analogi "karyawan baru yang amnesia"
- ✅ Istilah teknis (LLM, MCP, RAG, system prompt) **dipertahankan apa adanya**
- ✅ Bahasa ngobrol, ada emoji, ada warmth
- ✅ Tiap section ada analogi
- ✅ TL;DR di akhir
- ✅ Referensi lengkap

Pattern itu yang harus dicapai setiap kali skill ini dipakai.

---

## Edge Cases

### Kalau user minta topik yang terlalu dangkal
Skill ini tetep kasih penjelasan medium-deep — jangan terlalu dangkal. Tetep ada bobot kontennya.

### Kalau user minta topik yang super spesifik/niche
Tetap pake skill ini — tapi mungkin TL;DR lebih panjang karena banyak hal yang "lumrah" di topik itu jadi unfamiliar buat user awam.

### Kalau user campur bahasa (code-switching)
Tetap pake bahasa Indonesia sebagai base, tapi boleh selip istilah Inggris yang umum. Jangan full English.

### Kalau user minta response ringkas (cuma 2-3 paragraf)
Tetep pake skill ini, tapi compress. Minimal ada hook + analogi + intisari. Skip sections & referensi yang terlalu detail.

### Kalau ada error atau informasi yang gak ketemu di sumber
Tetep tulis dengan cara humanis — "maaf, bagian ini aku belum nemu referensinya" bukan "INFORMATION NOT FOUND IN SOURCE MATERIAL".

---

## Quick Checklist Sebelum Kirim

- [ ] Hook + analogi di paragraf pertama?
- [ ] Istilah teknis (LLM, MCP, RAG, etc.) **dipertahankan** apa adanya?
- [ ] Bahasa ngobrol / humanis, bukan formal?
- [ ] Tiap section ada analogi atau contoh?
- [ ] TL;DR / intisari di akhir?
- [ ] Ada referensi / link buat yang mau dive-in?
- [ ] Markdown terstruktur (heading, table, list)?
- [ ] File disimpan ke /tmp/<topik>-penjelasan.md?
- [ ] Dikirim via MEDIA: ke chat?
- [ ] Ada ringkasan singkat setelah kirim file?

Kalau semua ✅, skill ini dipakai dengan benar. 🚀
