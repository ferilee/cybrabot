# Gambaran CybraFeriBot

CybraFeriBot adalah bot Telegram hybrid berbasis Bun dan Hono.

Poin penting:
- Menerima update lewat webhook Telegram.
- Menyimpan data pengguna dan pesan ke SQLite.
- Menggunakan Gemini API untuk klasifikasi intent dan pembuatan jawaban.
- Memiliki dashboard dan panel admin untuk insight, knowledge, dan kontrol runtime.
- Bisa menerima PDF atau gambar, lalu membuat ringkasan dan menjawab pertanyaan tentang dokumen aktif.
- Bisa membuat file PDF atau DOCX dari permintaan pengguna.
- Didesain ringan agar cocok berjalan di VPS kecil.

Use case yang cocok:
- Menjawab pertanyaan umum.
- Membantu drafting singkat.
- Menjawab pertanyaan teknis ringan.
- Menyediakan informasi profil atau FAQ yang sudah disimpan di basis pengetahuan lokal.
- Membantu ringkasan dokumen dan tanya jawab berbasis file.
- Membuat dokumen siap kirim dalam format PDF atau DOCX.
