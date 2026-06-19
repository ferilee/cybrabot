export type VisionMode = 'summary' | 'qa' | 'solve' | 'screenshot' | 'ocr';

const solveHints = [
  'soal',
  'selesaikan',
  'kerjakan',
  'hitung',
  'jawab',
  'pecahkan',
  'matematika',
  'trigonometri',
  'aljabar',
  'integral',
  'turunan',
];

const screenshotHints = [
  'screenshot',
  'tampilan',
  'halaman',
  'website',
  'web',
  'ui',
  'bug',
  'error',
  'stack trace',
  'form',
  'dashboard',
];

const ocrHints = [
  'ocr',
  'ekstrak teks',
  'salin teks',
  'copy teks',
  'baca teks',
  'ambil teks',
  'teksnya',
];

const summaryHints = [
  'ringkas',
  'rangkum',
  'ringkasan',
  'rangkuman',
  'inti',
  'kesimpulan',
];

export function detectVisionMode(prompt?: string): VisionMode {
  const lower = String(prompt || '').trim().toLowerCase();

  if (!lower) {
    return 'summary';
  }

  if (solveHints.some((hint) => lower.includes(hint))) {
    return 'solve';
  }

  if (screenshotHints.some((hint) => lower.includes(hint))) {
    return 'screenshot';
  }

  if (ocrHints.some((hint) => lower.includes(hint))) {
    return 'ocr';
  }

  if (summaryHints.some((hint) => lower.includes(hint))) {
    return 'summary';
  }

  return 'qa';
}
