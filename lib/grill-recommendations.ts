import { listKnowledgeDocuments } from './knowledge';

type FocusArea = 'DASAR' | 'APLIKASI' | 'ANALISIS' | 'KETELITIAN';

export type KnowledgeRecommendation = {
  id: string;
  title: string;
  reason: string;
};

function matchKnowledgeId(topic: string) {
  const normalized = topic.toLowerCase();
  if (normalized.includes('trigonometri')) return 'matematika-trigonometri';
  if (normalized.includes('limit') || normalized.includes('turunan')) return 'matematika-limit-dan-turunan';
  if (normalized.includes('integral')) return 'matematika-integral';
  if (normalized.includes('peluang') || normalized.includes('statistika')) return 'matematika-statistika-dan-peluang';
  if (normalized.includes('barisan') || normalized.includes('deret')) return 'matematika-barisan-dan-deret';
  if (normalized.includes('aljabar') || normalized.includes('fungsi')) return 'matematika-aljabar-dan-fungsi';
  return null;
}

function buildReason(topic: string, focusHint: FocusArea, weakestDimension: string | null) {
  const topicReason = `Dokumen ini paling dekat dengan topik ${topic}.`;

  if (focusHint === 'DASAR') {
    return `${topicReason} Prioritaskan ulang konsep inti dan rumus dasar.`;
  }
  if (focusHint === 'APLIKASI') {
    return `${topicReason} Fokuskan bacaan pada contoh penerapan dan soal kontekstual.`;
  }
  if (focusHint === 'ANALISIS') {
    return `${topicReason} Baca ulang hubungan antar konsep dan bagian pembuktian/penalaran.`;
  }
  if (focusHint === 'KETELITIAN') {
    return `${topicReason} Gunakan dokumen ini untuk melatih langkah kerja yang lebih teliti.`;
  }

  if (weakestDimension === 'konsep') {
    return `${topicReason} Ulangi definisi, rumus, dan makna inti.`;
  }
  if (weakestDimension === 'langkah') {
    return `${topicReason} Fokus pada urutan langkah dan contoh pengerjaan.`;
  }
  if (weakestDimension === 'kejelasan') {
    return `${topicReason} Bacalah sambil melatih penjelasan ulang dengan bahasamu sendiri.`;
  }

  return topicReason;
}

export function recommendKnowledgeDocuments(input: {
  topic: string;
  focusHint: FocusArea;
  weakestDimension?: string | null;
  limit?: number;
}): KnowledgeRecommendation[] {
  const allDocs = listKnowledgeDocuments();
  const matchedId = matchKnowledgeId(input.topic);
  const recommendations: KnowledgeRecommendation[] = [];

  if (matchedId) {
    const doc = allDocs.find((item) => item.id === matchedId);
    if (doc) {
      recommendations.push({
        id: doc.id,
        title: doc.title,
        reason: buildReason(input.topic, input.focusHint, input.weakestDimension || null),
      });
    }
  }

  if (recommendations.length < (input.limit || 2)) {
    const genericDoc = allDocs.find((item) => item.id === 'teaching-assistant');
    if (genericDoc && !recommendations.some((item) => item.id === genericDoc.id)) {
      recommendations.push({
        id: genericDoc.id,
        title: genericDoc.title,
        reason: 'Gunakan sebagai panduan umum untuk langkah belajar sederhana dan tindak lanjut latihan.',
      });
    }
  }

  return recommendations.slice(0, input.limit || 2);
}
