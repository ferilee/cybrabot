# Limit dan Turunan

Materi ini merangkum konsep limit dan turunan yang menjadi inti kalkulus dasar SMA/SMK.

Limit:
- Limit menggambarkan nilai yang didekati fungsi saat variabel mendekati suatu titik tertentu.
- Notasi:
  - $$\lim_{x \to a} f(x)$$
- Limit tidak selalu sama dengan nilai fungsi di titik itu.

Konsep penting:
- Jika substitusi langsung berhasil, gunakan cara paling sederhana dulu.
- Jika muncul bentuk tak tentu seperti $\frac{0}{0}$, gunakan pemfaktoran, penyederhanaan, atau rasionalisasi.

Contoh bentuk penting:
- $$\lim_{x \to a} \frac{x^2 - a^2}{x-a} = \lim_{x \to a} \frac{(x-a)(x+a)}{x-a} = 2a$$

Turunan:
- Turunan menyatakan laju perubahan sesaat atau gradien garis singgung kurva.
- Notasi:
  - $$f'(x), \quad y', \quad \frac{dy}{dx}$$

Makna turunan:
- Jika $f'(x) > 0$, fungsi naik
- Jika $f'(x) < 0$, fungsi turun
- Jika $f'(x) = 0$, bisa menjadi titik stasioner

Rumus turunan dasar:
- $$\frac{d}{dx}(c) = 0$$
- $$\frac{d}{dx}(x^n) = nx^{n-1}$$
- $$\frac{d}{dx}(ax + b) = a$$
- $$\frac{d}{dx}(\sin x) = \cos x$$
- $$\frac{d}{dx}(\cos x) = -\sin x$$
- $$\frac{d}{dx}(\tan x) = \sec^2 x$$

Aturan turunan:
- Penjumlahan:
  - $$(f(x) + g(x))' = f'(x) + g'(x)$$
- Perkalian:
  - $$(fg)' = f'g + fg'$$
- Pembagian:
  - $$\left(\frac{f}{g}\right)' = \frac{f'g - fg'}{g^2}$$
- Rantai:
  - $$\frac{d}{dx}f(g(x)) = f'(g(x)) \cdot g'(x)$$

Aplikasi turunan:
- Menentukan gradien kurva
- Menentukan nilai maksimum dan minimum
- Menentukan kecepatan sesaat dalam konteks gerak

Langkah umum soal optimasi:
- Nyatakan besaran yang dicari sebagai fungsi
- Turunkan fungsi
- Cari titik saat turunan nol
- Uji titik itu sebagai maksimum atau minimum

Jebakan umum:
- Salah menurunkan konstanta
- Lupa memakai aturan rantai
- Menganggap semua titik dengan turunan nol pasti maksimum
- Langsung menyimpulkan tanpa memeriksa domain

Strategi belajar cepat:
- Kuasai pola turunan dasar dulu
- Latih identifikasi aturan: biasa, hasil kali, hasil bagi, atau rantai
- Saat limit tak tentu, sederhanakan bentuk dulu sebelum substitusi
