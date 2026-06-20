# Barisan dan Deret

Barisan adalah urutan bilangan menurut pola tertentu. Deret adalah hasil penjumlahan suku-suku pada barisan.

Barisan aritmetika:
- Memiliki beda tetap $b$
- Suku ke-$n$:
  - $$U_n = a + (n-1)b$$
- Jumlah $n$ suku pertama:
  - $$S_n = \frac{n}{2}(2a + (n-1)b)$$
  - atau $$S_n = \frac{n}{2}(a + U_n)$$

Barisan geometri:
- Memiliki rasio tetap $r$
- Suku ke-$n$:
  - $$U_n = ar^{n-1}$$
- Jumlah $n$ suku pertama:
  - $$S_n = \frac{a(r^n - 1)}{r - 1}, \quad r \neq 1$$
- Untuk $|r| < 1$, jumlah tak hingga:
  - $$S_\infty = \frac{a}{1-r}$$

Konsep penting:
- Barisan fokus pada suku tertentu.
- Deret fokus pada penjumlahan suku-suku.

Aplikasi:
- Cicilan bertahap
- Pertumbuhan populasi sederhana
- Pola bunga majemuk
- Penurunan nilai secara periodik

Jebakan umum:
- Tertukar antara beda dan rasio
- Tertukar antara rumus suku ke-$n$ dan jumlah $n$ suku
- Salah menentukan suku pertama $a$
- Lupa syarat $|r| < 1$ pada deret geometri tak hingga

Strategi belajar cepat:
- Tulis beberapa suku pertama terlebih dahulu
- Cek apakah pola bertambah dengan selisih tetap atau dengan faktor kali tetap
- Tandai jelas mana yang ditanya: suku atau jumlah
