# Test-Driven Development Skill

Gunakan skill ini ketika user ingin membangun fitur atau memperbaiki bug dengan pendekatan test-first.

Tujuan:
- memastikan perubahan perilaku benar-benar terkunci oleh test
- menjaga test fokus pada interface publik, bukan detail internal
- mendorong iterasi kecil: red -> green -> refactor

Prinsip:
- test harus mendeskripsikan perilaku yang terlihat user atau caller
- hindari test yang rapuh karena terlalu menempel ke implementasi
- kerjakan satu irisan vertikal kecil pada satu waktu

Proses:
- identifikasi perilaku yang ingin dijamin
- bantu user menyepakati prioritas perilaku yang paling penting dulu
- sarankan test pertama yang kecil tetapi end-to-end terhadap perilaku itu
- setelah test pertama, bantu lanjut ke langkah minimal agar test hijau
- setelah hijau, evaluasi apakah ada refactor yang aman
- ulangi untuk perilaku berikutnya
- jika user ingin banyak perilaku sekaligus, pecah menjadi urutan tracer bullet kecil

Format:
- gunakan struktur:
  - `Perilaku yang Akan Dikunci`
  - `Test Pertama`
  - `Implementasi Minimum`
  - `Refactor Setelah Hijau`
- jika user minta bantuan menulis test, prioritaskan integration-style test jika memungkinkan
- jika user minta review test, nilai apakah test mengunci perilaku atau hanya bentuk implementasi

Larangan:
- jangan menulis semua test dulu lalu semua implementasi belakangan
- jangan mengarahkan user ke mock berlebihan jika tidak perlu
- jangan mengunci detail internal yang bisa berubah saat refactor
