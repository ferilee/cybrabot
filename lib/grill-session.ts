import type { AdminConfig } from './admin-config';
import type { ChatHistoryItem, IntentResult, SkillResponseResult } from './ai';
import { generateSkillResponse } from './ai';
import {
  archivePersistedGrillSession,
  deletePersistedGrillSession,
  getPersistedGrillSession,
  savePersistedGrillSession,
} from './grill-session-store';
import { recommendKnowledgeDocuments } from './grill-recommendations';
import { retrieveKnowledge } from './knowledge';

type GrillPhase = 'awaiting_ready' | 'awaiting_answer' | 'awaiting_continue' | 'completed';
type ScoreMark = 'BENAR' | 'SEBAGIAN' | 'SALAH';
type FocusArea = 'DASAR' | 'APLIKASI' | 'ANALISIS' | 'KETELITIAN';
type RubricScores = {
  conceptAccuracy: 0 | 1 | 2;
  processAccuracy: 0 | 1 | 2;
  explanationClarity: 0 | 1;
};
type QuestionReview = {
  questionNumber: number;
  questionText: string;
  userAnswer: string;
  evaluation: string;
  scoreMark: ScoreMark;
  difficultyLevel: number;
  focusArea: FocusArea;
  rubric: RubricScores;
};

type GrillSession = {
  topic: string;
  material: string;
  totalQuestions: number;
  timerSeconds: number | null;
  currentQuestion: number;
  currentQuestionText: string | null;
  phase: GrillPhase;
  hardMode: boolean;
  difficultyLevel: number;
  focusHint: FocusArea;
  answeredCount: number;
  correctCount: number;
  partialCount: number;
  questionReviews: QuestionReview[];
};

const READY_RE = /\b(siap|mulai|gas|lanjut mulai|ayo mulai|start)\b/i;
const CONTINUE_RE = /\b(lanjut|next|soal berikutnya|lanjutkan)\b/i;
const END_RE = /\b(akhiri sesi|selesai sesi|sudahi sesi|stop sesi|berhenti sesi|end session|akhiri latihan)\b/i;
const NEW_SESSION_RE = /\b(uji saya|tes saya|grill me|interview saya|latihan interview|kritisi jawaban saya)\b/i;
const SCORE_RE = /^Skor Soal:\s*(BENAR|SEBAGIAN|SALAH)\s*$/im;
const CONCEPT_RE = /^Akurasi Konsep:\s*([0-2])\/2\s*$/im;
const PROCESS_RE = /^Ketelitian Langkah:\s*([0-2])\/2\s*$/im;
const CLARITY_RE = /^Kejelasan Penjelasan:\s*([0-1])\/1\s*$/im;
const FOCUS_RE = /^Fokus Berikutnya:\s*(DASAR|APLIKASI|ANALISIS|KETELITIAN)\s*$/im;

function inferTopicBlueprint(topic: string) {
  const normalized = topic.toLowerCase();

  if (normalized.includes('trigonometri')) {
    return [
      'Blueprint topik: trigonometri.',
      'Prioritaskan progres soal: nilai sudut istimewa -> identitas dasar -> aplikasi segitiga/kuadran -> pembuktian identitas.',
      'Jebakan utama: salah sisi terhadap sudut acuan, salah tanda kuadran, salah memilih identitas.',
    ].join('\n');
  }

  if (normalized.includes('limit') || normalized.includes('turunan')) {
    return [
      'Blueprint topik: limit dan turunan.',
      'Prioritaskan progres soal: substitusi/pemfaktoran limit -> turunan dasar -> aturan rantai/hasil kali/hasil bagi -> aplikasi gradien/optimasi.',
      'Jebakan utama: bentuk tak tentu tidak disederhanakan, lupa aturan rantai, salah menyimpulkan titik stasioner.',
    ].join('\n');
  }

  if (normalized.includes('integral')) {
    return [
      'Blueprint topik: integral.',
      'Prioritaskan progres soal: integral dasar -> substitusi sederhana -> integral tentu dan interpretasi luas.',
      'Jebakan utama: lupa konstanta integrasi, salah menaikkan pangkat, salah evaluasi batas integral tentu.',
    ].join('\n');
  }

  if (normalized.includes('peluang') || normalized.includes('statistika')) {
    return [
      'Blueprint topik: statistika dan peluang.',
      'Prioritaskan progres soal: ruang sampel/mean-median-modus -> peluang dasar dan komplemen -> irisan/gabungan -> kombinatorik sederhana.',
      'Jebakan utama: median tanpa urut data, salah membedakan kombinasi vs permutasi, salah mengurangi irisan kejadian.',
    ].join('\n');
  }

  if (normalized.includes('barisan') || normalized.includes('deret')) {
    return [
      'Blueprint topik: barisan dan deret.',
      'Prioritaskan progres soal: beda/rasio -> suku ke-n -> jumlah n suku -> aplikasi pola numerik.',
      'Jebakan utama: tertukar rumus aritmetika dan geometri, salah membaca indeks suku.',
    ].join('\n');
  }

  if (normalized.includes('aljabar') || normalized.includes('fungsi')) {
    return [
      'Blueprint topik: aljabar dan fungsi.',
      'Prioritaskan progres soal: operasi bentuk aljabar -> pemfaktoran -> persamaan/fungsi -> interpretasi grafik dasar.',
      'Jebakan utama: salah tanda, salah distribusi, salah domain fungsi.',
    ].join('\n');
  }

  return [
    'Blueprint topik: umum.',
    'Gunakan progres dari konsep dasar -> aplikasi -> analisis.',
    'Jaga agar tiap soal menargetkan satu miskonsepsi utama.',
  ].join('\n');
}

function normalizeKey(key: string) {
  return key.trim().toLowerCase();
}

function titleCase(input: string) {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTimer(seconds: number | null) {
  if (!seconds || seconds <= 0) return null;
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `[${minutes}:${secs}]`;
}

function formatTimerOption(seconds: number | null) {
  if (!seconds) return 'tanpa timer';
  return seconds >= 60 ? `${Math.floor(seconds / 60)} menit per soal` : `${seconds} detik per soal`;
}

function formatConfigLine(session: GrillSession) {
  return `Konfigurasi: ${session.totalQuestions} soal | ⏱ ${formatTimerOption(session.timerSeconds)} | Materi: ${session.topic}`;
}

function formatDifficultyLabel(level: number) {
  if (level <= 1) return 'dasar';
  if (level === 2) return 'aplikasi';
  return 'analitis';
}

function formatFocusHint(focus: FocusArea) {
  switch (focus) {
    case 'DASAR':
      return 'penguatan konsep dasar';
    case 'APLIKASI':
      return 'penerapan konsep ke kasus';
    case 'ANALISIS':
      return 'penalaran analitis dan pembuktian';
    case 'KETELITIAN':
      return 'ketelitian langkah dan perhitungan';
  }
}

function formatScoreValue(session: GrillSession) {
  const value = session.correctCount + (session.partialCount * 0.5);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatProgressBlock(session: GrillSession) {
  return [
    '## Progres Sesi',
    `- Soal selesai: ${session.answeredCount}/${session.totalQuestions}`,
    `- Skor sementara: ${formatScoreValue(session)}/${session.answeredCount || 0}`,
    `- Jawaban penuh benar: ${session.correctCount}`,
    `- Jawaban sebagian benar: ${session.partialCount}`,
    `- Level saat ini: ${formatDifficultyLabel(session.difficultyLevel)}`,
    `- Fokus berikutnya: ${formatFocusHint(session.focusHint)}`,
  ].join('\n');
}

function formatFinalSummary(session: GrillSession) {
  return [
    '## Ringkasan Akhir',
    `- Topik: ${session.topic}`,
    `- Total soal: ${session.totalQuestions}`,
    `- Skor akhir: ${formatScoreValue(session)}/${session.answeredCount || session.totalQuestions}`,
    `- Jawaban penuh benar: ${session.correctCount}`,
    `- Jawaban sebagian benar: ${session.partialCount}`,
    `- Level akhir: ${formatDifficultyLabel(session.difficultyLevel)}`,
    `- Fokus belajar terakhir: ${formatFocusHint(session.focusHint)}`,
  ].join('\n');
}

function buildRemedialRecommendations(session: GrillSession) {
  if (!session.questionReviews.length) {
    return ['Mulai lagi dengan 1-2 soal dasar agar baseline kemampuan lebih jelas.'];
  }

  const focusCounts = new Map<FocusArea, number>([
    ['DASAR', 0],
    ['APLIKASI', 0],
    ['ANALISIS', 0],
    ['KETELITIAN', 0],
  ]);
  let conceptPenalty = 0;
  let processPenalty = 0;
  let clarityPenalty = 0;

  for (const review of session.questionReviews) {
    focusCounts.set(review.focusArea, (focusCounts.get(review.focusArea) || 0) + 1);
    conceptPenalty += 2 - review.rubric.conceptAccuracy;
    processPenalty += 2 - review.rubric.processAccuracy;
    clarityPenalty += 1 - review.rubric.explanationClarity;
  }

  const dominantFocus = [...focusCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || session.focusHint;
  const recommendations: string[] = [];

  if (dominantFocus === 'DASAR') {
    recommendations.push('Ulangi konsep inti dan rumus dasar sebelum naik ke soal aplikasi.');
  } else if (dominantFocus === 'APLIKASI') {
    recommendations.push('Latih penerapan konsep ke variasi kasus nyata atau soal cerita singkat.');
  } else if (dominantFocus === 'ANALISIS') {
    recommendations.push('Fokus ke pembuktian, alasan memilih rumus, dan hubungan antar konsep.');
  } else if (dominantFocus === 'KETELITIAN') {
    recommendations.push('Perlambat ritme pengerjaan dan biasakan cek ulang langkah hitung atau substitusi.');
  }

  if (conceptPenalty >= processPenalty && conceptPenalty >= clarityPenalty) {
    recommendations.push('Sebelum sesi berikutnya, baca ulang contoh inti lalu jelaskan konsep itu dengan kata-katamu sendiri.');
  }
  if (processPenalty > conceptPenalty) {
    recommendations.push('Kerjakan 2-3 soal serupa dengan menulis langkah lengkap, bukan jawaban akhir saja.');
  }
  if (clarityPenalty > 0) {
    recommendations.push('Biasakan menuliskan alasan singkat mengapa kamu memilih rumus atau strategi tertentu.');
  }

  return recommendations.slice(0, 3);
}

function formatRemedialBlock(session: GrillSession) {
  const recommendations = buildRemedialRecommendations(session);
  const docs = recommendKnowledgeDocuments({
    topic: session.topic,
    focusHint: session.focusHint,
    weakestDimension: null,
    limit: 2,
  });
  return [
    '## Remedial Otomatis',
    ...recommendations.map((item) => `- ${item}`),
    ...(docs.length ? ['', '### Bacaan yang Disarankan', ...docs.map((doc) => `- ${doc.title}: ${doc.reason}`)] : []),
  ].join('\n');
}

function extractTopic(message: string) {
  const cleaned = message
    .replace(/\/grill\b/gi, '')
    .replace(/\b(uji saya|tes saya|grill me|interview saya|latihan interview|kritisi jawaban saya)\b/gi, '')
    .replace(/\b\d+\s*soal\b/gi, ' ')
    .replace(/\b\d+\s*(detik|menit)(\s*per\s*soal)?\b/gi, ' ')
    .replace(/\b(tentang|mengenai|soal)\b/gi, ' ')
    .replace(/[,:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return titleCase(cleaned || 'Topik Umum');
}

function parseConfig(message: string) {
  const lower = message.toLowerCase();
  const totalMatch = lower.match(/(\d+)\s*soal/);
  const totalQuestions = totalMatch ? clamp(Number(totalMatch[1]), 1, 20) : null;

  const timerMatch = lower.match(/(\d+)\s*(detik|menit)(?:\s*per\s*soal)?/);
  let timerSeconds: number | null = null;
  if (timerMatch) {
    const value = clamp(Number(timerMatch[1]), 1, 120);
    timerSeconds = timerMatch[2] === 'menit' ? value * 60 : value;
  }

  const hardMode = /\b(sulit|susah|menantang|hard|hardcore|lebih sulit|lebih susah)\b/i.test(message);
  return { totalQuestions, timerSeconds, hardMode };
}

function parseScoreMark(text: string): ScoreMark {
  const match = text.match(SCORE_RE);
  return (match?.[1]?.toUpperCase() as ScoreMark) || 'SALAH';
}

function parseRubricScores(text: string): RubricScores {
  const concept = Number(text.match(CONCEPT_RE)?.[1] || 0) as 0 | 1 | 2;
  const process = Number(text.match(PROCESS_RE)?.[1] || 0) as 0 | 1 | 2;
  const clarity = Number(text.match(CLARITY_RE)?.[1] || 0) as 0 | 1;
  return {
    conceptAccuracy: concept,
    processAccuracy: process,
    explanationClarity: clarity,
  };
}

function parseFocusArea(text: string): FocusArea {
  return (text.match(FOCUS_RE)?.[1] as FocusArea) || 'DASAR';
}

function stripScoreMark(text: string) {
  return text
    .replace(SCORE_RE, '')
    .replace(CONCEPT_RE, '')
    .replace(PROCESS_RE, '')
    .replace(CLARITY_RE, '')
    .replace(FOCUS_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyScoreMark(session: GrillSession, mark: ScoreMark) {
  session.answeredCount += 1;
  if (mark === 'BENAR') session.correctCount += 1;
  if (mark === 'SEBAGIAN') session.partialCount += 1;
}

function serializeQuestionReviews(reviews: QuestionReview[]) {
  return JSON.stringify(reviews);
}

function parseQuestionReviews(raw: string | null | undefined): QuestionReview[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function updateAdaptiveState(session: GrillSession, scoreMark: ScoreMark, rubric: RubricScores, focusArea: FocusArea) {
  session.focusHint = focusArea;
  const totalRubric = rubric.conceptAccuracy + rubric.processAccuracy + rubric.explanationClarity;

  if (scoreMark === 'BENAR' && totalRubric >= 4) {
    session.difficultyLevel = clamp(session.difficultyLevel + 1, 1, 3);
    return;
  }

  if (scoreMark === 'SALAH' || rubric.conceptAccuracy === 0) {
    session.difficultyLevel = clamp(session.difficultyLevel - 1, 1, 3);
    return;
  }

  if (scoreMark === 'SEBAGIAN' && totalRubric >= 3 && session.hardMode) {
    session.difficultyLevel = clamp(session.difficultyLevel + 1, 1, 3);
  }
}

function formatRubricBlock(rubric: RubricScores, focusArea: FocusArea) {
  return [
    '## Rubrik Penilaian',
    `- Akurasi konsep: ${rubric.conceptAccuracy}/2`,
    `- Ketelitian langkah: ${rubric.processAccuracy}/2`,
    `- Kejelasan penjelasan: ${rubric.explanationClarity}/1`,
    `- Fokus berikutnya: ${formatFocusHint(focusArea)}`,
  ].join('\n');
}

function toStoredSession(session: GrillSession, sessionKey: string) {
  return {
    sessionKey,
    topic: session.topic,
    material: session.material,
    totalQuestions: session.totalQuestions,
    timerSeconds: session.timerSeconds,
    currentQuestion: session.currentQuestion,
    currentQuestionText: session.currentQuestionText,
    phase: session.phase,
    hardMode: session.hardMode,
    difficultyLevel: session.difficultyLevel,
    focusHint: session.focusHint,
    answeredCount: session.answeredCount,
    correctCount: session.correctCount,
    partialCount: session.partialCount,
    questionReviews: serializeQuestionReviews(session.questionReviews),
  };
}

function fromStoredSession(row: Awaited<ReturnType<typeof getPersistedGrillSession>>): GrillSession | null {
  if (!row) return null;
  return {
    topic: row.topic,
    material: row.material,
    totalQuestions: row.totalQuestions,
    timerSeconds: row.timerSeconds ?? null,
    currentQuestion: row.currentQuestion,
    currentQuestionText: row.currentQuestionText ?? null,
    phase: row.phase as GrillPhase,
    hardMode: Boolean(row.hardMode),
    difficultyLevel: row.difficultyLevel,
    focusHint: (row.focusHint as FocusArea | null) || 'DASAR',
    answeredCount: row.answeredCount,
    correctCount: row.correctCount,
    partialCount: row.partialCount,
    questionReviews: parseQuestionReviews(row.questionReviews),
  };
}

async function loadSession(sessionKey: string) {
  return fromStoredSession(await getPersistedGrillSession(sessionKey));
}

async function persistSession(sessionKey: string, session: GrillSession) {
  await savePersistedGrillSession(toStoredSession(session, sessionKey));
}

async function clearSession(sessionKey: string) {
  await deletePersistedGrillSession(sessionKey);
}

async function archiveAndClearSession(sessionKey: string, session: GrillSession, reason: 'completed' | 'ended_by_user') {
  const finalReview = makeEndedReply(session, reason === 'completed' ? 'completed' : 'user');
  await archivePersistedGrillSession({
    sessionKey,
    email: sessionKey.includes('@') ? sessionKey : null,
    topic: session.topic,
    totalQuestions: session.totalQuestions,
    answeredCount: session.answeredCount,
    correctCount: session.correctCount,
    partialCount: session.partialCount,
    timerSeconds: session.timerSeconds,
    hardMode: session.hardMode,
    difficultyLevel: session.difficultyLevel,
    focusHint: session.focusHint,
    endedReason: reason,
    finalReview,
    questionReviews: serializeQuestionReviews(session.questionReviews),
  });
  await clearSession(sessionKey);
}

async function buildMaterial(topic: string, adminConfig: AdminConfig) {
  const matches = retrieveKnowledge(topic, 3);
  if (!matches.length) {
    const generated = await generateSkillResponse({
      message: `Susun bahan bacaan ringkas untuk topik ${topic}`,
      skillTitle: 'Grill Me',
      skillInstructions:
        'Buat bahan bacaan ringkas sebelum sesi uji. Jelaskan konsep inti, rumus penting, jebakan umum, dan tips belajar cepat. Jangan beri pertanyaan dulu.',
      externalContext:
        'Tidak ada knowledge lokal yang cocok. Jelaskan bahwa briefing ini dibuat dari pengetahuan umum model secara jujur, lalu tetap bantu user belajar.',
      adminConfig,
    });
    return generated.text;
  }

  const knowledgeContext = matches
    .map((item) => `Sumber: ${item.title}\n${item.content}`)
    .join('\n\n');

  const generated = await generateSkillResponse({
    message: `Susun bahan bacaan ringkas untuk topik ${topic}`,
    skillTitle: 'Grill Me',
    skillInstructions:
      'Gunakan knowledge lokal yang diberikan untuk membuat bahan bacaan ringkas sebelum sesi uji. Fokus pada konsep inti, rumus penting, jebakan umum, dan strategi belajar cepat. Jangan beri pertanyaan dulu.',
    externalContext: `Knowledge lokal untuk bahan bacaan awal:\n${knowledgeContext}`,
    adminConfig,
  });

  return generated.text;
}

async function buildQuestion(session: GrillSession, adminConfig: AdminConfig) {
  const timerLabel = formatTimer(session.timerSeconds);
  const difficulty = session.hardMode
    ? 'Naikkan tingkat kesulitan sedikit demi sedikit dan buat soal lebih menantang.'
    : 'Jaga tingkat kesulitan tetap wajar untuk latihan bertahap.';
  const blueprint = inferTopicBlueprint(session.topic);

  const response = await generateSkillResponse({
    message: `Buat soal ${session.currentQuestion} dari ${session.totalQuestions} untuk topik ${session.topic}`,
    skillTitle: 'Grill Me',
    skillInstructions:
      'Buat satu soal saja. Format judul harus persis `## Soal X dari Y [MM:SS]` jika ada timer, atau `## Soal X dari Y` jika tanpa timer. ' +
      'Setelah soal, beri petunjuk singkat bila perlu. Jangan beri evaluasi atau soal berikutnya.',
    externalContext:
      `${difficulty}\n` +
      `Target level soal: ${formatDifficultyLabel(session.difficultyLevel)}.\n` +
      `Fokus area: ${formatFocusHint(session.focusHint)}.\n` +
      `${blueprint}\n` +
      `Materi acuan:\n${session.material}\n\n` +
      `Gunakan timer label: ${timerLabel || 'tanpa timer'}.`,
    adminConfig,
  });

  return response.text;
}

async function buildEvaluation(session: GrillSession, answer: string, adminConfig: AdminConfig) {
  const hasNext = session.currentQuestion < session.totalQuestions;
  const promptTail = hasNext
    ? 'Akhiri dengan ajakan eksplisit: "Jika sudah siap, tekan tombol \\"Lanjut ke Soal Berikutnya\\" atau ketik lanjut."'
    : 'Akhiri dengan penutup bahwa sesi latihan selesai.';

  const response = await generateSkillResponse({
    message: `Evaluasi jawaban user untuk soal ${session.currentQuestion}: ${answer}`,
    skillTitle: 'Grill Me',
    skillInstructions:
      'Buat evaluasi jawaban user. Gunakan judul `## Evaluasi Jawaban`. ' +
      'Jelaskan yang sudah kuat, yang perlu diperbaiki, dan pembahasan ringkas. ' +
      'JANGAN tampilkan soal berikutnya dalam balasan yang sama. ' +
      'Setelah evaluasi naratif, tambahkan marker persis: `Akurasi Konsep: X/2`, `Ketelitian Langkah: Y/2`, `Kejelasan Penjelasan: Z/1`, `Fokus Berikutnya: DASAR|APLIKASI|ANALISIS|KETELITIAN`. ' +
      'Tambahkan satu baris terakhir persis dengan format `Skor Soal: BENAR`, `Skor Soal: SEBAGIAN`, atau `Skor Soal: SALAH`. ' +
      promptTail,
    externalContext:
      `Topik: ${session.topic}\n` +
      `Materi acuan:\n${session.material}\n\n` +
      `Soal aktif:\n${session.currentQuestionText || '-'}`,
    adminConfig,
  });

  return response.text;
}

function makeStudyReply(session: GrillSession) {
  const timerOption = session.timerSeconds
    ? `Timer aktif ${formatTimerOption(session.timerSeconds)}`
    : 'Tanpa timer';

  return [
    `# Sesi Latihan ${session.topic}`,
    '',
    `${formatConfigLine(session)}`,
    '',
    formatProgressBlock(session),
    '',
    '## Bahan Bacaan Ringkas',
    '',
    session.material,
    '',
    '## Opsi Tantangan',
    `- Jumlah soal saat ini: ${session.totalQuestions}`,
    `- ${timerOption}`,
    `- Mode tantangan: ${session.hardMode ? 'lebih sulit' : 'standar'}`,
    '',
    'Kalau mau ubah konfigurasi, kirim misalnya `5 soal`, `10 soal`, `30 detik`, atau `1 menit per soal`.',
    'Kalau sudah siap, ketik `siap` untuk mulai soal pertama.',
    'Kalau ingin berhenti, ketik `akhiri sesi`.',
  ].join('\n');
}

function makeQuestionReply(session: GrillSession) {
  return [
    `# Sesi Latihan ${session.topic}`,
    '',
    formatConfigLine(session),
    '',
    formatProgressBlock(session),
    '',
    session.currentQuestionText || '',
    '',
    'Jika waktu habis, tetap kirim jawaban terbaikmu. Untuk menghentikan sesi, ketik `akhiri sesi`.',
  ].join('\n');
}

function makeEndedReply(session: GrillSession, reason: 'user' | 'completed') {
  return [
    reason === 'completed' ? 'Sesi latihan selesai.' : 'Sesi latihan diakhiri.',
    '',
    formatFinalSummary(session),
    '',
    formatRemedialBlock(session),
    '',
    'Kalau mau, kirim topik baru untuk mulai sesi berikutnya.',
  ].join('\n');
}

function buildSessionResult(
  input: { intent: IntentResult['intent']; intentModel: string | null },
  reply: string,
): SkillResponseResult & { skill: { id: string; title: string } } {
  return {
    reply,
    route: 'skill_ai',
    skill: { id: 'grill-me', title: 'Grill Me' },
    model: 'session:grill-me',
    latencyMs: 0,
    knowledgeMatches: [],
    fallback: false,
    reach: null,
    intent: input.intent,
    intentModel: input.intentModel,
    exportFile: null,
  };
}

export async function hasActiveGrillSession(sessionKey?: string | null) {
  if (!sessionKey) return false;
  const session = await loadSession(normalizeKey(sessionKey));
  return Boolean(session && session.phase !== 'completed');
}

export async function clearGrillSession(sessionKey?: string | null) {
  if (!sessionKey) return;
  await clearSession(normalizeKey(sessionKey));
}

export async function runGrillSession(input: {
  sessionKey: string;
  message: string;
  history?: ChatHistoryItem[];
  adminConfig: AdminConfig;
  intent: IntentResult['intent'];
  intentModel: string | null;
}): Promise<SkillResponseResult & { skill: { id: string; title: string } }> {
  const key = normalizeKey(input.sessionKey);
  const rawMessage = input.message.trim();
  const config = parseConfig(rawMessage);
  let session = await loadSession(key);

  if (session && END_RE.test(rawMessage)) {
    await archiveAndClearSession(key, session, 'ended_by_user');
    return buildSessionResult(input, makeEndedReply(session, 'user'));
  }

  const startsNew = NEW_SESSION_RE.test(rawMessage) || (!session && rawMessage.length > 0);
  if (!session && startsNew) {
    const topic = extractTopic(rawMessage);
    const totalQuestions = config.totalQuestions ?? (config.hardMode ? 5 : 3);
    const timerSeconds = config.timerSeconds ?? null;
    const material = await buildMaterial(topic, input.adminConfig);
    session = {
      topic,
      material,
      totalQuestions,
      timerSeconds,
      currentQuestion: 0,
      currentQuestionText: null,
      phase: 'awaiting_ready',
      hardMode: config.hardMode,
      difficultyLevel: config.hardMode ? 2 : 1,
      focusHint: 'DASAR',
      answeredCount: 0,
      correctCount: 0,
      partialCount: 0,
      questionReviews: [],
    };
    await persistSession(key, session);
    return buildSessionResult(input, makeStudyReply(session));
  }

  if (!session) {
    return buildSessionResult(input, 'Tulis topik yang ingin diuji dulu, misalnya `uji saya tentang trigonometri`.');
  }

  if (NEW_SESSION_RE.test(rawMessage)) {
    await clearSession(key);
    return runGrillSession(input);
  }

  if (session.phase === 'awaiting_ready') {
    if (config.totalQuestions) session.totalQuestions = config.totalQuestions;
    if (config.timerSeconds !== null) session.timerSeconds = config.timerSeconds;
    if (config.hardMode) session.hardMode = true;
    await persistSession(key, session);

    if (!READY_RE.test(rawMessage)) {
      return buildSessionResult(input, makeStudyReply(session));
    }

    session.currentQuestion = 1;
    session.currentQuestionText = await buildQuestion(session, input.adminConfig);
    session.phase = 'awaiting_answer';
    await persistSession(key, session);
    return buildSessionResult(input, makeQuestionReply(session));
  }

  if (session.phase === 'awaiting_answer') {
    const questionDifficultyLevel = session.difficultyLevel;
    const evaluation = await buildEvaluation(session, rawMessage, input.adminConfig);
    const scoreMark = parseScoreMark(evaluation);
    const rubric = parseRubricScores(evaluation);
    const focusArea = parseFocusArea(evaluation);
    const cleanedEvaluation = stripScoreMark(evaluation);
    applyScoreMark(session, scoreMark);
    updateAdaptiveState(session, scoreMark, rubric, focusArea);
    session.questionReviews.push({
      questionNumber: session.currentQuestion,
      questionText: session.currentQuestionText || '',
      userAnswer: rawMessage,
      evaluation: cleanedEvaluation,
      scoreMark,
      difficultyLevel: questionDifficultyLevel,
      focusArea,
      rubric,
    });
    session.phase = session.currentQuestion >= session.totalQuestions ? 'completed' : 'awaiting_continue';

    const reply = [
      cleanedEvaluation,
      '',
      formatRubricBlock(rubric, focusArea),
      '',
      formatProgressBlock(session),
      ...(session.phase === 'completed' ? ['', 'Sesi latihan sudah selesai.', '', formatFinalSummary(session), '', formatRemedialBlock(session)] : []),
    ].join('\n');

    if (session.phase === 'completed') {
      await archivePersistedGrillSession({
        sessionKey: key,
        email: key.includes('@') ? key : null,
        topic: session.topic,
        totalQuestions: session.totalQuestions,
        answeredCount: session.answeredCount,
        correctCount: session.correctCount,
        partialCount: session.partialCount,
        timerSeconds: session.timerSeconds,
        hardMode: session.hardMode,
        difficultyLevel: session.difficultyLevel,
        focusHint: session.focusHint,
        endedReason: 'completed',
        finalReview: reply,
        questionReviews: serializeQuestionReviews(session.questionReviews),
      });
      await clearSession(key);
      return buildSessionResult(input, reply);
    }

    await persistSession(key, session);
    return buildSessionResult(input, reply);
  }

  if (session.phase === 'awaiting_continue') {
    if (!CONTINUE_RE.test(rawMessage)) {
      return buildSessionResult(
        input,
        'Silakan pelajari evaluasinya dulu. Kalau sudah siap, tekan tombol "Lanjut ke Soal Berikutnya" atau ketik `lanjut`. Untuk menghentikan sesi, ketik `akhiri sesi`.',
      );
    }

    session.currentQuestion += 1;
    session.currentQuestionText = await buildQuestion(session, input.adminConfig);
    session.phase = 'awaiting_answer';
    await persistSession(key, session);
    return buildSessionResult(input, makeQuestionReply(session));
  }

  await clearSession(key);
  return buildSessionResult(input, 'Sesi latihan sudah selesai. Kalau mau, kirim topik baru untuk mulai sesi berikutnya.');
}
