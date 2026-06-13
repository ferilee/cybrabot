import { retrieveKnowledge } from './knowledge';

type ToolResult = {
  handled: boolean;
  response?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
};

function cleanExpression(input: string) {
  return input
    .replace(/[^0-9+\-*/().,%x÷\s]/gi, '')
    .replace(/x/gi, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.')
    .trim();
}

function tryMathTool(text: string): ToolResult {
  const lower = text.toLowerCase();
  const asksCalculation =
    lower.includes('hitung') ||
    lower.includes('berapa hasil') ||
    lower.includes('kalkulasi') ||
    /[0-9]\s*[-+*/x÷][\s0-9(]/i.test(text);

  if (!asksCalculation) {
    return { handled: false };
  }

  const expression = cleanExpression(text);
  if (!expression || !/[0-9]/.test(expression)) {
    return { handled: false };
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { handled: false };
    }

    return {
      handled: true,
      toolName: 'math',
      response: `<b>Hasil perhitungan:</b> ${result}`,
      metadata: {
        expression,
        result,
      },
    };
  } catch {
    return { handled: false };
  }
}

function extractTopic(text: string, triggerPhrases: string[]) {
  const lower = text.toLowerCase();

  for (const phrase of triggerPhrases) {
    const index = lower.indexOf(phrase);
    if (index >= 0) {
      const topic = text.slice(index + phrase.length).trim().replace(/^[:,-]\s*/, '');
      return topic || 'kegiatan sekolah';
    }
  }

  return '';
}

function tryCaptionTool(text: string): ToolResult {
  const lower = text.toLowerCase();
  const wantsCaption =
    lower.includes('buatkan caption') ||
    lower.includes('bikin caption') ||
    lower.includes('caption instagram') ||
    lower.includes('caption sekolah');

  if (!wantsCaption) {
    return { handled: false };
  }

  const topic = extractTopic(text, ['buatkan caption', 'bikin caption', 'caption instagram', 'caption sekolah']);
  const response = `<b>Caption Siap Pakai</b>

${topic ? `${topic.charAt(0).toUpperCase()}${topic.slice(1)}` : 'Kegiatan sekolah hari ini'} menjadi momen yang penuh semangat, kolaborasi, dan pembelajaran bermakna.

Terima kasih kepada semua pihak yang sudah berkontribusi. Semoga kegiatan ini membawa manfaat dan inspirasi untuk terus bertumbuh bersama.

#Sekolah #Pendidikan #BelajarBersama`;

  return {
    handled: true,
    toolName: 'caption',
    response,
    metadata: {
      topic,
    },
  };
}

function tryAnnouncementTool(text: string): ToolResult {
  const lower = text.toLowerCase();
  const wantsAnnouncement =
    lower.includes('buatkan pengumuman') ||
    lower.includes('bikin pengumuman') ||
    lower.includes('buatkan pemberitahuan') ||
    lower.includes('buatkan surat singkat');

  if (!wantsAnnouncement) {
    return { handled: false };
  }

  const topic = extractTopic(text, [
    'buatkan pengumuman',
    'bikin pengumuman',
    'buatkan pemberitahuan',
    'buatkan surat singkat',
  ]);

  const response = `<b>Draft Pengumuman</b>

Yth. Bapak/Ibu/Saudara,

Dengan hormat, kami sampaikan bahwa ${topic || 'akan ada kegiatan sekolah sesuai agenda yang telah ditentukan'}.

Mohon perhatian dan kerja sama dari seluruh pihak terkait agar kegiatan dapat berjalan dengan tertib dan lancar.

Terima kasih atas perhatian dan partisipasinya.

Hormat kami,
Tim Sekolah`;

  return {
    handled: true,
    toolName: 'announcement',
    response,
    metadata: {
      topic,
    },
  };
}

function tryFaqTool(text: string): ToolResult {
  const matches = retrieveKnowledge(text, 1);
  if (!matches.length) {
    return { handled: false };
  }

  const lower = text.toLowerCase();
  const looksLikeFaq =
    lower.includes('siapa') ||
    lower.includes('apa itu') ||
    lower.includes('untuk apa') ||
    lower.includes('fungsi') ||
    lower.includes('cocok dipakai');

  if (!looksLikeFaq) {
    return { handled: false };
  }

  const topMatch = matches[0];
  if (!topMatch) {
    return { handled: false };
  }

  return {
    handled: true,
    toolName: 'faq',
    response: `<b>${topMatch.title}</b>\n\n${topMatch.content}`,
    metadata: {
      knowledgeId: topMatch.id,
    },
  };
}

export function runLocalTool(text: string): ToolResult {
  const tools = [tryMathTool, tryCaptionTool, tryAnnouncementTool, tryFaqTool];

  for (const tool of tools) {
    const result = tool(text);
    if (result.handled) {
      return result;
    }
  }

  return { handled: false };
}
