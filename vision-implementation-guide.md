# Panduan Implementasi Vision untuk CybraBot

## Gambaran Singkat

**Vision** adalah kemampuan model AI untuk memahami input visual seperti:

- gambar
- screenshot
- foto dokumen
- PDF scan
- tabel atau diagram

Kalau model teks biasa itu seperti orang yang cuma bisa membaca chat, maka model dengan **vision** itu seperti orang yang juga bisa melihat lampiran yang dikirim user.

Di CybraBot, fitur vision cocok dipakai untuk:

- membaca soal dari gambar
- meringkas PDF scan
- menjawab pertanyaan berdasarkan isi dokumen visual
- membaca screenshot error atau tampilan aplikasi
- memahami tabel, diagram, atau lembar kerja

---

## Kapan Vision Perlu Dipakai

Pakai vision kalau input user bergantung pada tampilan visual:

- `image/jpeg`, `image/png`, `image/webp`
- PDF hasil scan
- screenshot UI
- foto tulisan tangan
- soal dari kamera

Tidak perlu pakai vision kalau:

- isi file sudah berupa teks biasa
- PDF bisa diekstrak langsung sebagai teks
- user hanya mengirim pesan teks

Aturan praktis:

- **text first** kalau dokumen memang tekstual
- **vision fallback** kalau dokumen berupa scan atau gambar

---

## Arsitektur yang Disarankan

Implementasi vision di CybraBot sebaiknya dibagi menjadi 5 lapisan:

1. **Input handler**
2. **File normalization**
3. **Vision adapter**
4. **Task router**
5. **Response formatter / exporter**

### 1. Input Handler

Tugasnya:

- menerima file dari Telegram atau web chat
- validasi ukuran file
- validasi mime type
- simpan file ke penyimpanan sementara

Contoh jenis file:

- `application/pdf`
- `image/jpeg`
- `image/png`
- `image/webp`

### 2. File Normalization

Tujuannya menyiapkan file agar model mudah memprosesnya.

Contoh:

- PDF text-based: coba ekstrak teks dulu
- PDF scan: kirim ke jalur vision
- image: kirim langsung ke model vision
- gambar terlalu besar: resize atau kompres lebih dulu

### 3. Vision Adapter

Lapisan ini membungkus provider AI yang dipakai.

Tugasnya:

- menerima file + prompt
- mengirim request ke model multimodal
- menerima jawaban teks
- normalisasi error dan metadata

### 4. Task Router

Lapisan ini menentukan user sebenarnya meminta apa.

Contoh intent vision:

- `summarize_visual_document`
- `solve_from_image`
- `extract_text_from_image`
- `answer_question_about_visual_document`
- `describe_screenshot`

### 5. Response Formatter / Exporter

Setelah model menjawab:

- kirim jawaban ke Telegram/web
- kalau user minta file, ekspor ke `md`, `pdf`, atau `docx`

---

## Alur Request yang Disarankan

## Alur Gambar

1. User kirim gambar
2. Bot download file
3. Bot deteksi mime type
4. Bot analisis caption atau pertanyaan user
5. Bot kirim gambar + prompt ke model vision
6. Bot terima jawaban
7. Bot kirim jawaban atau file hasil ekspor

## Alur PDF

1. User kirim PDF
2. Bot cek apakah PDF tekstual atau scan
3. Kalau tekstual:
   - ekstrak teks
   - pakai jalur text/document QA biasa
4. Kalau scan:
   - kirim lewat jalur vision
5. Bot jawab atau ekspor hasil

---

## Use Case yang Perlu Didukung

### 1. Ringkasan Dokumen

Prompt contoh:

```text
Ringkas isi dokumen ini dalam bahasa Indonesia.
Fokus pada poin utama, kesimpulan, dan data penting.
Kalau dokumen berisi tabel atau diagram, jelaskan maknanya.
```

### 2. Menjawab Pertanyaan dari Dokumen

Prompt contoh:

```text
Baca dokumen visual ini lalu jawab pertanyaan berikut:
"Apa kesimpulan utama dari dokumen ini?"
Kalau informasi tidak ada, jawab dengan jujur.
```

### 3. Menyelesaikan Soal dari Gambar

Prompt contoh:

```text
Baca soal pada gambar ini.
Tulis ulang soalnya dengan rapi.
Lalu selesaikan langkah demi langkah dalam bahasa Indonesia.
```

### 4. Membaca Screenshot Error

Prompt contoh:

```text
Analisis screenshot ini.
Jelaskan error yang terlihat, kemungkinan penyebabnya, dan langkah perbaikannya.
```

### 5. OCR + Pemahaman

Prompt contoh:

```text
Ekstrak teks yang terlihat pada gambar ini.
Setelah itu, jelaskan isi teks tersebut secara singkat.
```

---

## Struktur Modul yang Disarankan

Di repo CybraBot, implementasi vision akan lebih rapi kalau dipisah seperti ini:

```text
lib/
  vision.ts
  vision-router.ts
  vision-prompts.ts
  vision-provider.ts
  file-normalizer.ts
  image-utils.ts
```

### `lib/vision.ts`

Facade utama untuk memproses permintaan visual.

Tanggung jawab:

- menerima input file
- memanggil router
- memanggil provider
- mengembalikan hasil final

### `lib/vision-router.ts`

Menentukan jenis tugas berdasarkan:

- mime type
- caption user
- konteks sesi

### `lib/vision-prompts.ts`

Berisi prompt template untuk:

- summarize
- OCR
- solve math
- screenshot analysis
- document QA

### `lib/vision-provider.ts`

Adapter untuk provider AI vision.

Jangan campur logika provider ke handler Telegram langsung. Itu bikin coupling jelek dan nanti susah ganti model.

### `lib/file-normalizer.ts`

Untuk:

- resize gambar
- validasi ukuran
- tentukan PDF scan vs PDF text

### `lib/image-utils.ts`

Opsional, untuk util seperti:

- hitung dimensi
- kompres
- konversi format

---

## Kontrak Data yang Disarankan

### Input

```ts
type VisionTaskInput = {
  filePath: string;
  mimeType: string;
  fileName: string;
  userPrompt?: string;
  mode?: 'auto' | 'summary' | 'qa' | 'ocr' | 'solve' | 'screenshot';
};
```

### Output

```ts
type VisionTaskResult = {
  text: string;
  mode: 'summary' | 'qa' | 'ocr' | 'solve' | 'screenshot';
  model: string;
  latencyMs: number;
  fallback: boolean;
  extractedText?: string;
};
```

---

## Contoh Interface Implementasi

```ts
export async function runVisionTask(input: VisionTaskInput): Promise<VisionTaskResult> {
  // 1. normalisasi file
  // 2. pilih mode
  // 3. bangun prompt
  // 4. panggil provider
  // 5. normalisasi hasil
  return {
    text: '',
    mode: 'summary',
    model: '',
    latencyMs: 0,
    fallback: false,
  };
}
```

---

## Integrasi ke Telegram Bot

### Kondisi yang sebaiknya memicu vision

1. user upload gambar tanpa teks
2. user upload gambar dengan caption seperti:
   - `tolong baca ini`
   - `ringkas gambar ini`
   - `selesaikan soal ini`
3. user upload PDF scan
4. user bertanya ke dokumen aktif yang sumbernya gambar/scan

### Integrasi yang disarankan

Di handler:

- `bot.on('message:photo', ...)`
- `bot.on('message:document', ...)`

Tambahkan routing:

```ts
if (mimeType.startsWith('image/')) {
  // masuk vision
}

if (mimeType === 'application/pdf') {
  // cek dulu text-based atau scan
}
```

### Perilaku yang bagus untuk UX

Saat file masuk:

```text
Sedang membaca file yang Kakak kirim. Tunggu sebentar, saya lihat dulu isinya.
```

Setelah selesai:

- kirim hasil ringkasan
- atau langsung jawab pertanyaan
- atau tawarkan ekspor:
  - `Kalau mau, hasil ini bisa saya kirim sebagai PDF/DOCX/MD juga.`

---

## Integrasi ke Web Chat

Untuk web chat, tambahkan dukungan:

- upload gambar
- upload PDF
- preview file
- tombol `Ringkas`
- tombol `Tanya isi dokumen`
- tombol `Unduh hasil`

Kalau saat ini web chat baru text-only, maka urutan implementasi yang masuk akal:

1. backend vision dulu
2. endpoint upload file
3. endpoint chat vision
4. baru UI upload file

---

## Pilihan Model

Karena vision butuh model multimodal, provider harus benar-benar mendukung input visual.

### Opsi umum

- **Gemini multimodal**
  - cocok untuk gambar, dokumen visual, dan OCR ringan
- **OpenAI-compatible multimodal**
  - bisa dipakai kalau provider upstream mendukung image input
- **Model OCR terpisah**
  - dipakai kalau mau ekstraksi teks lebih akurat sebelum LLM

### Strategi yang disarankan

- **primary**: model multimodal untuk jawaban langsung
- **fallback**: OCR/text extraction lalu LLM text-only

Contoh:

1. coba vision model
2. kalau gagal:
   - ekstrak teks
   - pakai jalur document/text QA biasa

---

## Validasi dan Batasan

Sebelum file dikirim ke model:

- cek ukuran maksimal
- cek tipe file
- cek jumlah halaman PDF kalau perlu
- cek gambar terlalu kecil / terlalu blur

Contoh batas awal:

- gambar max 10 MB
- PDF max 20 MB
- maksimum 20 halaman untuk mode interaktif cepat

Kalau file terlalu besar:

```text
File-nya terlalu besar untuk diproses langsung. Coba kirim versi yang lebih kecil atau pecah per bagian.
```

---

## Error Handling yang Perlu Ada

Minimal tangani kondisi ini:

- file gagal diunduh
- mime type tidak didukung
- model vision gagal merespons
- gambar tidak terbaca
- PDF rusak
- timeout provider

Contoh respons yang baik:

```text
Saya sudah coba baca filenya, tapi isinya belum cukup jelas untuk dipahami.
Coba kirim versi yang lebih tajam atau beri instruksi yang lebih spesifik.
```

Jangan kirim stack trace mentah ke user.

---

## Logging dan Observability

Tambahkan event terpisah supaya mudah dianalisis:

- `vision.requested`
- `vision.completed`
- `vision.failed`
- `vision.fallback_used`

Payload yang bagus:

- `userId`
- `mimeType`
- `fileName`
- `mode`
- `model`
- `latencyMs`
- `fallback`

Ini penting supaya nanti Anda bisa tahu:

- use case vision paling sering apa
- file type mana yang paling sering gagal
- model mana yang paling stabil

---

## Strategi Implementasi Bertahap

### Tahap 1

Tambahkan vision untuk:

- `message:photo`
- gambar soal
- gambar screenshot

Target:

- baca
- ringkas
- jawab

### Tahap 2

Tambahkan PDF scan detection.

Target:

- text PDF → document pipeline
- scan PDF → vision pipeline

### Tahap 3

Tambahkan export hasil:

- `md`
- `pdf`
- `docx`

### Tahap 4

Tambahkan multi-turn visual QA.

Contoh:

1. user kirim file
2. bot simpan sesi dokumen visual
3. user tanya beberapa kali soal file yang sama

### Tahap 5

Tambahkan optimasi:

- cache hasil OCR
- cache extracted text
- fallback berlapis
- kompres gambar otomatis

---

## Contoh Prompt yang Bagus

## A. Untuk ringkasan

```text
Kamu menerima dokumen visual.
Baca isinya dengan teliti.
Tulis ringkasan dalam bahasa Indonesia yang jelas.
Fokus pada:
- topik utama
- poin penting
- kesimpulan
- data penting
Kalau ada tabel atau diagram, jelaskan artinya secara singkat.
```

## B. Untuk soal matematika

```text
Baca soal pada gambar ini.
Tulis ulang soalnya dengan rapi.
Lalu selesaikan langkah demi langkah.
Kalau tulisan tidak jelas, sebutkan bagian yang ambigu.
```

## C. Untuk screenshot error

```text
Analisis screenshot ini.
Identifikasi pesan error yang terlihat.
Jelaskan penyebab yang paling mungkin.
Berikan langkah perbaikan yang praktis dan berurutan.
```

---

## Hal yang Sering Salah di Implementasi Vision

### 1. Semua PDF dipaksa ke vision

Ini boros. Banyak PDF sebenarnya sudah bisa dibaca sebagai teks biasa.

### 2. Jawaban vision disimpan dalam format HTML kaya UI

Untuk ekspor file, simpan konten mentah atau markdown yang bersih.

### 3. Gambar langsung dilempar ke model tanpa normalisasi

Kalau gambar terlalu besar atau blur, hasilnya jelek dan mahal.

### 4. Tidak ada fallback

Kalau model vision gagal, user langsung mentok. Harus ada jalur cadangan.

### 5. Prompt terlalu umum

`Jelaskan gambar ini` sering terlalu lemah.
Lebih baik prompt spesifik sesuai tugas.

---

## Rekomendasi Praktis untuk CybraBot

Kalau target Anda adalah fitur yang benar-benar terasa berguna, urutan terbaiknya:

1. gambar soal dan screenshot dulu
2. PDF scan kedua
3. sesi tanya-jawab dokumen visual ketiga
4. ekspor hasil ke file keempat

Alasannya sederhana:

- dampak user paling cepat terasa
- kompleksitas masih terkendali
- debugging lebih mudah

---

## TL;DR

**Vision** adalah kemampuan AI untuk memahami input visual seperti gambar, screenshot, dan PDF scan.

Implementasi yang sehat untuk CybraBot:

1. terima file
2. normalisasi file
3. tentukan task
4. kirim ke model vision
5. balas hasilnya
6. kalau diminta, ekspor ke `md/pdf/docx`

Prinsip penting:

- jangan semua file dipaksa ke vision
- pisahkan provider vision dari handler Telegram
- simpan hasil dalam format bersih
- sediakan fallback
- log semua proses penting

---

## Langkah Lanjut yang Disarankan

Kalau panduan ini mau langsung dieksekusi, urutan implementasi berikut paling masuk akal:

1. buat `lib/vision-provider.ts`
2. buat `lib/vision-router.ts`
3. sambungkan `message:photo` ke pipeline vision
4. tambah deteksi PDF scan vs PDF text
5. sambungkan hasil ke ekspor file

