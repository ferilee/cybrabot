import { getAdminConfig } from './admin-config';
import type { ChatHistoryItem } from './ai';
import { resolveManagedExportPath } from './humanis-export';
import { logEvent } from './observability';
import { runSkillChat } from './skill-chat';
import { runLocalTool } from './tools';
import { loadWebSkills } from './web-skills';

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
      intent: null,
      intentModel: null,
      latencyMs: 0,
      knowledgeMatches: [],
      fallback: false,
      reach: null,
      exportFile: null,
    };
  }

  const adminConfig = await getAdminConfig();
  const toolResult = runLocalTool(message, adminConfig);

  if (toolResult.handled && toolResult.response) {
    await logEvent('web_chat.tool_used', {
      skillId: null,
      toolName: toolResult.toolName,
      durationMs: Date.now() - startedAt,
    });

    return {
      reply: stripHtml(toolResult.response),
      route: 'tool',
      skill: null,
      model: 'local',
      intent: 'casual',
      intentModel: null,
      latencyMs: Date.now() - startedAt,
      knowledgeMatches: [],
      fallback: false,
      reach: null,
      exportFile: null,
    };
  }

  const response = await runSkillChat({
    message,
    history: toAiHistory(input.history),
    adminConfig,
    requestedSkillId: input.skillId,
  });

  await logEvent('web_chat.ai_used', {
    skillId: response.skill?.id || null,
    intent: response.intent,
    intentModel: response.intentModel,
    model: response.model,
    latencyMs: response.latencyMs,
    knowledgeMatches: response.knowledgeMatches,
    fallback: response.fallback,
    durationMs: Date.now() - startedAt,
    reach: response.reach,
  });

  return {
    reply: response.reply,
    route: response.route,
    skill: response.skill,
    model: response.model,
    intent: response.intent,
    intentModel: response.intentModel,
    latencyMs: response.latencyMs,
    knowledgeMatches: response.knowledgeMatches,
    reach: response.reach,
    fallback: response.fallback,
    exportFile: response.exportFile
      ? {
          fileName: response.exportFile.fileName,
          format: response.exportFile.format,
          downloadUrl: `/api/exports/${encodeURIComponent(response.exportFile.fileName)}`,
        }
      : null,
  };
}

export function getManagedExportFile(fileName: string) {
  return resolveManagedExportPath(fileName);
}
