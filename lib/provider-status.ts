import 'dotenv/config';

export type ProviderQuotaStatus =
  | {
      ok: true;
      provider: 'tokenrouter';
      endpoint: string;
      summary: string;
      raw: Record<string, unknown>;
    }
  | {
      ok: false;
      provider: 'tokenrouter';
      endpoint?: string;
      summary: string;
      raw?: unknown;
    };

function getOpenAICompatibleConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || process.env.TOKENROUTER_API_KEY || '';
  const baseURL =
    process.env.OPENAI_BASE_URL ||
    process.env.OPENAI_COMPAT_BASE_URL ||
    process.env.TOKENROUTER_BASE_URL ||
    'https://api.tokenrouter.com/v1';

  return {
    apiKey: apiKey.trim(),
    baseURL: baseURL.trim().replace(/\/+$/, ''),
  };
}

function buildStatusCandidates(baseURL: string) {
  const candidates = new Set<string>();
  const normalized = baseURL.replace(/\/+$/, '');
  candidates.add(`${normalized}/status`);
  if (!normalized.endsWith('/v1')) {
    candidates.add(`${normalized}/v1/status`);
  }
  return [...candidates];
}

function summarizeStatusPayload(payload: Record<string, unknown>) {
  const parts: string[] = [];

  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    parts.push(`${label}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  };

  push('status', payload.status);
  push('mode', payload.mode);
  push('provider', payload.provider);
  push('model', payload.model);
  push('key', payload.key);
  push('quota', payload.quota);
  push('remaining', payload.remaining);
  push('used', payload.used);
  push('requests', payload.requests);
  push('tokens', payload.tokens);
  push('wallet', payload.wallet);
  push('balance', payload.balance);
  push('limit', payload.limit);
  push('resetAt', payload.resetAt);
  push('updatedAt', payload.updatedAt);

  return parts.length ? parts.join('\n') : JSON.stringify(payload, null, 2);
}

export async function getProviderQuotaStatus(): Promise<ProviderQuotaStatus> {
  const { apiKey, baseURL } = getOpenAICompatibleConfig();

  if (!apiKey) {
    return {
      ok: false,
      provider: 'tokenrouter',
      summary: 'OPENAI_API_KEY / TOKENROUTER_API_KEY belum diisi, jadi kuota provider tidak bisa dicek.',
    };
  }

  for (const endpoint of buildStatusCandidates(baseURL)) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      if (response.status === 404 || response.status === 405) {
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json')
        ? await response.json()
        : { text: await response.text() };

      if (!response.ok) {
        return {
          ok: false,
          provider: 'tokenrouter',
          endpoint,
          summary: `Status endpoint merespons ${response.status}.`,
          raw: body,
        };
      }

      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const raw = body as Record<string, unknown>;
        return {
          ok: true,
          provider: 'tokenrouter',
          endpoint,
          summary: summarizeStatusPayload(raw),
          raw,
        };
      }

      return {
        ok: true,
        provider: 'tokenrouter',
        endpoint,
        summary: typeof body === 'string' ? body : JSON.stringify(body),
        raw: { body },
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'tokenrouter',
        endpoint,
        summary: `Gagal membaca status provider: ${String(error)}`,
      };
    }
  }

  return {
    ok: false,
    provider: 'tokenrouter',
    summary: `Endpoint status tidak ditemukan di ${baseURL}.`,
  };
}
