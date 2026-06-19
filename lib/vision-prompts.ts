import type { VisionMode } from './vision-router';

export function buildVisionPrompt(mode: VisionMode, prompt?: string) {
  const userPrompt = String(prompt || '').trim();

  switch (mode) {
    case 'solve':
      return (
        `Baca isi gambar ini dengan teliti.\n` +
        `Kalau berisi soal, tulis ulang inti soalnya dengan rapi lalu selesaikan langkah demi langkah.\n` +
        `Tampilkan jawaban akhir dengan jelas.\n` +
        `Kalau ada bagian yang ambigu atau tidak terbaca, sebutkan bagian itu secara jujur.\n` +
        (userPrompt ? `\nPermintaan pengguna: ${userPrompt}` : '')
      );
    case 'screenshot':
      return (
        `Analisis gambar ini sebagai screenshot antarmuka atau error.\n` +
        `Jelaskan apa yang terlihat, masalah yang paling mungkin, dan langkah perbaikannya.\n` +
        `Kalau tidak ada error yang jelas, jelaskan konteks tampilannya.\n` +
        (userPrompt ? `\nPermintaan pengguna: ${userPrompt}` : '')
      );
    case 'ocr':
      return (
        `Ekstrak teks yang terlihat pada gambar ini.\n` +
        `Setelah itu, jelaskan isi teks tersebut secara singkat dalam bahasa Indonesia.\n` +
        `Kalau ada bagian yang tidak terbaca, tandai dengan jelas.\n` +
        (userPrompt ? `\nPermintaan pengguna: ${userPrompt}` : '')
      );
    case 'qa':
      return (
        `Jawab permintaan pengguna berdasarkan isi gambar ini.\n` +
        `Baca teks, angka, tabel, ekspresi, atau elemen visual yang terlihat dengan teliti.\n` +
        `Kalau jawabannya tidak terlihat jelas di gambar, katakan dengan jujur.\n` +
        `Gunakan bahasa Indonesia yang rapi dan langsung ke poin.\n` +
        (userPrompt ? `\nPermintaan pengguna: ${userPrompt}` : '')
      );
    case 'summary':
    default:
      return (
        `Baca gambar ini dan buat ringkasan dalam bahasa Indonesia.\n` +
        `Fokus pada teks yang terlihat, data penting, dan kesimpulan yang bisa diambil.\n` +
        `Kalau gambar berisi soal, tampilkan langkah penyelesaian dan jawaban akhirnya.\n` +
        (userPrompt ? `\nPermintaan pengguna: ${userPrompt}` : '')
      );
  }
}
