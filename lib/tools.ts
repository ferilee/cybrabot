import { retrieveKnowledge } from './knowledge';
import type { AdminConfig } from './admin-config';

type ToolResult = {
  handled: boolean;
  response?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
};

function isMetaBotQuestion(text: string) {
  const lower = text.toLowerCase();
  return lower.includes('cybraferibot') ||
    lower.includes('bot ini') ||
    lower.includes('kamu bisa apa') ||
    lower.includes('fiturmu') ||
    lower.includes('fitur kamu') ||
    lower.includes('cara kerjamu') ||
    lower.includes('cara kerja bot');
}

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

function tryCapabilityTool(text: string, config?: AdminConfig): ToolResult {
  const lower = text.toLowerCase();
  const asksAboutImprovement =
    (lower.includes('meningkatkan kemampuan') ||
      lower.includes('supaya lebih pintar') ||
      lower.includes('agar lebih pintar') ||
      lower.includes('fitur apa lagi') ||
      lower.includes('apa yang bisa ditambah') ||
      lower.includes('bagaimana kamu bisa berkembang')) &&
    (lower.includes('bot') || lower.includes('kamu') || lower.includes('cybraferibot'));

  if (!asksAboutImprovement) {
    return { handled: false };
  }

  return {
    handled: true,
    toolName: 'self_describe',
    response: config?.selfDescribe.improvement,
    metadata: {
      topic: 'capability_improvement',
    },
  };
}

function trySelfDescribeTool(text: string, config?: AdminConfig): ToolResult {
  if (!isMetaBotQuestion(text)) {
    return { handled: false };
  }

  const lower = text.toLowerCase();

  if (
    lower.includes('fitur') ||
    lower.includes('bisa apa') ||
    lower.includes('fungsi') ||
    lower.includes('untuk apa')
  ) {
    return {
      handled: true,
      toolName: 'self_describe',
      response: config?.selfDescribe.features,
      metadata: {
        topic: 'bot_features',
      },
    };
  }

  if (lower.includes('cara kerja') || lower.includes('kerjamu')) {
    return {
      handled: true,
      toolName: 'self_describe',
      response: config?.selfDescribe.workflow,
      metadata: {
        topic: 'bot_workflow',
      },
    };
  }

  return {
    handled: true,
    toolName: 'self_describe',
    response: config?.selfDescribe.identity,
    metadata: {
      topic: 'bot_identity',
    },
  };
}

export function runLocalTool(text: string, config?: AdminConfig) {
  const tools = [
    { name: 'faq', fn: (value: string) => tryCapabilityTool(value, config) },
    { name: 'faq', fn: (value: string) => trySelfDescribeTool(value, config) },
    { name: 'math', fn: tryMathTool },
    { name: 'caption', fn: tryCaptionTool },
    { name: 'announcement', fn: tryAnnouncementTool },
    { name: 'faq', fn: tryFaqTool },
  ] as const;

  for (const tool of tools) {
    if (config && config.enabledTools[tool.name] === false) {
      continue;
    }

    const result = tool.fn(text);
    if (result.handled) {
      return result;
    }
  }

  return { handled: false };
}
