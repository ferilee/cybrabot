type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

export function logEvent(event: string, payload: LogPayload = {}, level: LogLevel = 'info') {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  };

  const serialized = JSON.stringify(entry);

  if (level === 'error') {
    console.error(serialized);
    return;
  }

  if (level === 'warn') {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}
