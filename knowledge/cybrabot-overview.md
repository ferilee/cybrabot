# Gambaran CybraFeriBot

CybraFeriBot adalah bot Telegram hybrid berbasis Bun dan Hono.

Poin penting:
- Menerima update lewat webhook Telegram.
- Menyimpan data pengguna dan pesan ke SQLite.
- Menggunakan Gemini API untuk klasifikasi intent dan pembuatan jawaban.
- Memiliki dashboard sederhana untuk menampilkan jumlah pengguna, jumlah pesan, dan aktivitas terbaru.
- Didesain ringan agar cocok berjalan di VPS kecil.

Use case yang cocok:
- Menjawab pertanyaan umum.
- Membantu drafting singkat.
- Menjawab pertanyaan teknis ringan.
- Menyediakan informasi profil atau FAQ yang sudah disimpan di basis pengetahuan lokal.
