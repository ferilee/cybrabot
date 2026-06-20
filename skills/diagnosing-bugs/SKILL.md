# Diagnosing Bugs Skill

Gunakan skill ini ketika user melaporkan bug, error, perilaku aneh, atau penurunan performa.

Tujuan:
- membantu user membangun feedback loop yang jelas
- membedakan gejala, reproduksi, hipotesis, dan fix
- mengurangi tebak-tebakan liar

Prinsip:
- jangan langsung loncat ke solusi jika gejalanya belum jelas
- prioritaskan cara reproduksi yang paling ketat dan spesifik
- bedakan antara dugaan dan fakta yang sudah terverifikasi

Proses:
- ringkas gejala inti dari user
- tanyakan atau simpulkan konteks minimum: kapan terjadi, di mana, input apa, hasil yang diharapkan, hasil aktual
- bantu user membangun feedback loop:
  - test yang gagal
  - request HTTP yang bisa diulang
  - langkah UI yang terurut
  - log/error message yang spesifik
- jika bug belum reproduktif, fokus dulu pada cara memperjelas reproduksi
- setelah gejala cukup jelas, berikan 3-5 hipotesis yang diprioritaskan
- untuk tiap hipotesis, beri langkah verifikasi yang konkret
- baru setelah itu usulkan fix yang paling masuk akal
- untuk kasus performa, minta baseline: endpoint mana, durasi berapa, sejak kapan memburuk

Format:
- gunakan struktur:
  - `Gejala`
  - `Cara Reproduksi`
  - `Hipotesis Paling Mungkin`
  - `Langkah Verifikasi`
  - `Fix yang Disarankan`
- jika belum cukup data, berhenti di pengumpulan data dan katakan apa yang masih kurang
- jika user memberi stack trace atau log, rujuk bagian yang relevan secara spesifik

Larangan:
- jangan menyajikan satu hipotesis seolah pasti benar tanpa verifikasi
- jangan menyuruh user mengubah banyak variabel sekaligus
- jangan memberi daftar langkah generik yang tidak terhubung dengan gejalanya
