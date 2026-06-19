import { getAdminConfig } from './admin-config';
import { runAgentReach } from './agent-reach';
import { generateSkillResponse, type ChatHistoryItem } from './ai';
import { logEvent } from './observability';
import { runLocalTool } from './tools';
import { loadWebSkills, selectWebSkill } from './web-skills';

export type WebChatHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type WebChatRequest = {
  message: string;
  skillId?: string;
  history?: WebChatHistoryItem[];
};

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function toAiHistory(history: WebChatHistoryItem[] = []): ChatHistoryItem[] {
  return history
    .slice(-12)
    .filter((item) => item.content.trim())
    .map((item) => ({
      role: item.role === 'assistant' ? 'bot' : 'user',
      content: item.content,
    }));
}

export function getWebChatSkills() {
  return loadWebSkills().map((skill) => ({
    id: skill.id,
    title: skill.title,
    description: skill.description,
    triggers: skill.triggers,
    modelHint: skill.modelHint,
  }));
}

export async function handleWebChat(input: WebChatRequest) {
  const startedAt = Date.now();
  const message = input.message.trim();

  if (!message) {
    return {
      reply: 'Tulis pesan terlebih dahulu.',
      route: 'validation',
      skill: null,
      model: null,
      latencyMs: 0,
      knowledgeMatches: [],
      fallback: false,
    };
  }

  const adminConfig = await getAdminConfig();
  const skill = selectWebSkill(message, input.skillId);
  const toolResult = runLocalTool(message, adminConfig);

  if (toolResult.handled && toolResult.response) {
    await logEvent('web_chat.tool_used', {
      skillId: skill?.id || null,
      toolName: toolResult.toolName,
      durationMs: Date.now() - startedAt,
    });

    return {
      reply: stripHtml(toolResult.response),
      route: 'tool',
      skill: skill ? { id: skill.id, title: skill.title } : null,
      model: 'local',
      latencyMs: Date.now() - startedAt,
      knowledgeMatches: [],
      fallback: false,
    };
  }

  if (!skill) {
    return {
      reply: 'Belum ada skill web chat yang tersedia.',
      route: 'no_skill',
      skill: null,
      model: null,
      latencyMs: 0,
      knowledgeMatches: [],
      fallback: true,
    };
  }

  let externalContext = '';
  let reachMetadata: Record<string, unknown> | null = null;
  if (skill.id === 'internet-research') {
    try {
      const reach = await runAgentReach(message);
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

  const response = await generateSkillResponse({
    message,
    history: toAiHistory(input.history),
    skillTitle: skill.title,
    skillInstructions: skill.instructions,
    externalContext,
    adminConfig,
  });

  await logEvent('web_chat.ai_used', {
    skillId: skill.id,
    model: response.model,
    latencyMs: response.latencyMs,
    knowledgeMatches: response.knowledgeMatches,
    fallback: response.fallback,
    durationMs: Date.now() - startedAt,
    reach: reachMetadata,
  });

  return {
    reply: response.text,
    route: 'skill_ai',
    skill: {
      id: skill.id,
      title: skill.title,
    },
    model: response.model,
    latencyMs: response.latencyMs,
    knowledgeMatches: response.knowledgeMatches,
    reach: reachMetadata,
    fallback: response.fallback,
  };
}
