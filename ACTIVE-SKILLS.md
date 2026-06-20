# Daftar Skill Aktif Cybra

Dokumen ini mencatat skill yang saat ini aktif di runtime Cybra.

Catatan:
- Skill aktif dimuat dari folder `skills/`
- Skill di folder `.skills/` belum dibaca langsung oleh loader runtime
- Satu skill dianggap aktif jika memiliki `skill.json` dan `SKILL.md`

## Skill Aktif

### 1. Diagnosing Bugs
- **ID:** `diagnosing-bugs`
- **Fungsi:** mendiagnosis bug, error, dan regresi performa
- **Trigger utama:** `debug ini`, `diagnosa bug`, `diagnose this`, `aplikasi tidak jalan`, `fitur ini rusak`, `slow query`

### 2. Document Drafting
- **ID:** `document-drafting`
- **Fungsi:** menyusun draft surat, proposal, pengumuman, notulen, caption, dan dokumen sekolah
- **Trigger utama:** `buatkan`, `draft`, `surat`, `proposal`, `pengumuman`, `caption`, `dokumen`

### 3. General Chat
- **ID:** `general-chat`
- **Fungsi:** menjawab pertanyaan umum dengan memanfaatkan knowledge lokal bila relevan
- **Trigger utama:** `tanya`, `jelaskan`, `apa`, `bagaimana`, `kenapa`, `siapa`

### 4. Grill Me
- **ID:** `grill-me`
- **Fungsi:** menguji pemahaman user dengan sesi soal adaptif, timer, evaluasi, remedial, dan arsip audit
- **Trigger utama:** `grill me`, `uji saya`, `tes saya`, `interview saya`, `latihan interview`, `kritisi jawaban saya`

### 5. Internet Research
- **ID:** `internet-research`
- **Fungsi:** membaca URL, repo GitHub, YouTube, dan riset web lewat Agent Reach
- **Trigger utama:** `http://`, `https://`, `github.com`, `youtube.com`, `baca web`, `riset internet`

### 6. Penjelasan Humanis
- **ID:** `penjelasan-humanis`
- **Fungsi:** menjelaskan topik kompleks dengan bahasa awam, analogi, dan gaya ngobrol
- **Trigger utama:** `bahasa awam`, `penjelasan humanis`, `kasih analogi`, `eli5`, `gampang dicerna`

### 7. RAG Research
- **ID:** `rag-research`
- **Fungsi:** menjawab dengan menekankan knowledge base lokal dan batasan sumber
- **Trigger utama:** `berdasarkan data`, `knowledge`, `sumber`, `referensi`, `profil`, `feri`

### 8. Teach
- **ID:** `teach`
- **Fungsi:** mengajar konsep atau keterampilan baru secara bertahap
- **Trigger utama:** `ajari saya`, `ajarkan saya`, `saya mau belajar`, `bantu saya belajar`, `teach me`

### 9. Technical Helper
- **ID:** `technical-helper`
- **Fungsi:** membantu debugging, coding, deployment, API, database, Docker, dan konfigurasi teknis
- **Trigger utama:** `error`, `bug`, `kode`, `deploy`, `docker`, `api`, `database`, `server`

### 10. Test-Driven Development
- **ID:** `test-driven-development`
- **Fungsi:** memandu implementasi test-first dengan alur red-green-refactor
- **Trigger utama:** `tdd`, `test-driven`, `red green refactor`, `tulis test dulu`, `integration test`, `test first`

## Ringkasan

Total skill aktif saat ini: **10**

Fokus utama kemampuan Cybra saat ini:
- chat umum
- penjelasan humanis
- riset web dan RAG lokal
- tutoring dan pengujian belajar
- debugging teknis
- drafting dokumen
- workflow test-first
