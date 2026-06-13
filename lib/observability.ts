import { db } from '../db';
import { telemetryEvents } from '../db/schema';

type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

const persistedEvents = new Set([
  'message.intent_classified',
  'message.preference_updated',
  'message.tool_used',
  'message.ai_used',
  'message.completed',
  'message.failed',
  'document.received',
  'document.summarized',
  'document.question_answered',
]);

export async function logEvent(event: string, payload: LogPayload = {}, level: LogLevel = 'info') {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  };

  const serialized = JSON.stringify(entry);

  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }

  if (!persistedEvents.has(event)) {
    return;
  }

  try {
    await db.insert(telemetryEvents).values({
      event,
      level,
      payload: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'telemetry.persist_failed',
      originalEvent: event,
      error: String(error),
    }));
  }
}
