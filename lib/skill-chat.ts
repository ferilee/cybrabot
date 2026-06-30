import type { AdminConfig } from './admin-config';
import { runAgentReach } from './agent-reach';
import { generateSkillResponse, getIntent, type ChatHistoryItem, type IntentResult } from './ai';
import { hasActiveGrillSession, runGrillSession } from './grill-session';
import { detectHumanisMarkdownRequest, materializeHumanisMarkdown, type HumanisExportFile } from './humanis-export';
import { getKnowledgeContext } from './knowledge';
import { getWebSkill, selectWebSkill } from './web-skills';

export type SkillChatResult = {
  reply: string;
  route: 'skill_ai' | 'no_skill';
  skill: { id: string; title: string } | null;
  model: string | null;
  latencyMs: number;
  knowledgeMatches: string[];
  fallback: boolean;
  reach: Record<string, unknown> | null;
  intent: IntentResult['intent'];
  intentModel: string | null;
  exportFile: HumanisExportFile | null;
};

export async function runSkillChat(input: {
  message: string;
  history?: ChatHistoryItem[];
  adminConfig: AdminConfig;
  requestedSkillId?: string;
  intentHint?: IntentResult;
  sessionKey?: string;
  surface?: 'telegram' | 'web';
}) {
  const history = input.history || [];
  const intentResult = input.intentHint || await getIntent(input.message, input.adminConfig);
  const activeGrillSession = await hasActiveGrillSession(input.sessionKey);
  const skill = activeGrillSession
    ? getWebSkill('grill-me')
    : selectWebSkill(input.message, input.requestedSkillId, intentResult.intent);

  if (!skill) {
    return {
      reply: 'Belum ada skill chat yang tersedia.',
      route: 'no_skill' as const,
      skill: null,
      model: null,
      latencyMs: 0,
      knowledgeMatches: [],
      fallback: true,
      reach: null,
      intent: intentResult.intent,
      intentModel: intentResult.model,
      exportFile: null,
    };
  }

  if (skill.id === 'grill-me' && input.sessionKey) {
    return runGrillSession({
      sessionKey: input.sessionKey,
      message: input.message,
      history,
      adminConfig: input.adminConfig,
      intent: intentResult.intent,
      intentModel: intentResult.model,
    });
  }

  let externalContext = '';
  let reachMetadata: Record<string, unknown> | null = null;

  if (skill.id === 'internet-research') {
    try {
      const reach = await runAgentReach(input.message);
      externalContext =
        `Agent Reach channel: ${reach.channel}\n` +
        `Backend: ${reach.backend}\n` +
        `Sources: ${reach.sources.join(', ')}\n\n` +
        `${reach.content}`;
      reachMetadata = {
        channel: reach.channel,
        backend: reach.backend,
        sources: reach.sources,
      };
    } catch (error) {
      externalContext =
        `Agent Reach gagal mengambil konteks eksternal: ${String(error)}\n` +
        `Jawab dengan menjelaskan keterbatasan ini dan berikan langkah yang bisa dilakukan user.`;
      reachMetadata = {
        error: String(error),
      };
    }
  }

  if (skill.id === 'grill-me') {
    const ragSkill = getWebSkill('rag-research');
    const knowledge = await getKnowledgeContext(input.message);

    if (knowledge.context) {
      externalContext +=
        `${externalContext ? `\n\n` : ''}` +
        `Gunakan knowledge base lokal berikut sebagai bahan bacaan awal sebelum mulai menguji user.\n` +
        `Prioritaskan konteks ini untuk menyusun briefing belajar.\n` +
        `${ragSkill ? `Panduan RAG:\n${ragSkill.instructions}\n\n` : ''}` +
        `${knowledge.context}`;
    } else {
      externalContext +=
        `${externalContext ? `\n\n` : ''}` +
        `Belum ada knowledge base lokal yang relevan untuk topik ini.\n` +
        `Saat menyusun bahan bacaan awal, katakan secara jujur bahwa briefing dibuat dari pengetahuan umum model, bukan dari knowledge lokal khusus.`;
    }
  }

  const response = await generateSkillResponse({
    message: input.message,
    history,
    skillTitle: skill.title,
    skillInstructions: skill.instructions,
    externalContext,
    surface: input.surface || 'telegram',
    adminConfig: input.adminConfig,
  });

  let exportFile: HumanisExportFile | null = null;
  if (skill.id === 'penjelasan-humanis') {
    const exportRequest = detectHumanisMarkdownRequest(input.message);
    if (exportRequest) {
      exportFile = await materializeHumanisMarkdown(exportRequest.title, response.text);
    }
  }

  return {
    reply: response.text,
    route: 'skill_ai' as const,
    skill: {
      id: skill.id,
      title: skill.title,
    },
    model: response.model,
    latencyMs: response.latencyMs,
    knowledgeMatches: response.knowledgeMatches,
    fallback: response.fallback,
    reach: reachMetadata,
    intent: intentResult.intent,
    intentModel: intentResult.model,
    exportFile,
  };
}
