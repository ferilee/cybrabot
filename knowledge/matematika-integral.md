# Integral Dasar

Integral adalah kebalikan dari turunan dan juga dapat dipakai untuk menghitung luas daerah.

Konsep inti:
- Integral tak tentu menghasilkan keluarga fungsi:
  - $$\int f(x)\,dx = F(x) + C$$
  - dengan $F'(x) = f(x)$
- Integral tentu menghitung akumulasi atau luas bersih pada interval:
  - $$\int_a^b f(x)\,dx = F(b) - F(a)$$

Rumus dasar integral:
- $$\int x^n\,dx = \frac{x^{n+1}}{n+1} + C, \quad n \neq -1$$
- $$\int \frac{1}{x}\,dx = \ln |x| + C$$
- $$\int e^x\,dx = e^x + C$$
- $$\int \sin x\,dx = -\cos x + C$$
- $$\int \cos x\,dx = \sin x + C$$

Hubungan turunan dan integral:
- Jika turunan itu "mencari perubahan", integral tak tentu "mengembalikan bentuk asal".
- Integral tentu sering ditafsirkan sebagai total akumulasi pada rentang tertentu.

Metode yang sering dipakai:
- Substitusi sederhana
- Pemfaktoran atau penyederhanaan bentuk
- Memecah integral menjadi beberapa suku

Contoh sederhana:
- $$\int (3x^2 + 4x - 5)\,dx = x^3 + 2x^2 - 5x + C$$

Luas daerah:
- Jika grafik di atas sumbu-$x$, maka integral tentu memberi luas daerah itu.
- Jika ada bagian di bawah sumbu-$x$, integral memberi luas bersih, sehingga bagian bawah bernilai negatif.

Jebakan umum:
- Lupa menambahkan konstanta $C$ pada integral tak tentu
- Salah menaikkan pangkat pada aturan pangkat
- Menggunakan aturan pangkat pada $\frac{1}{x}$ tanpa memperhatikan kasus khusus
- Menganggap integral tentu selalu sama dengan luas geometris tanpa memperhatikan tanda

Strategi belajar cepat:
- Cocokkan integral dengan turunan dasar yang sudah dihafal
- Biasakan cek hasil dengan menurunkan kembali
- Pisahkan kasus integral tak tentu dan integral tentu
