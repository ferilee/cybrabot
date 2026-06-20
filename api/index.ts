import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { join } from 'path';
import { handleUpdate } from '../bot';
import { getAdminConfig, isValidAdminToken, saveAdminConfig } from '../lib/admin-config';
import { deleteKnowledgeDocument, listKnowledgeDocuments, saveKnowledgeDocument } from '../lib/knowledge';
import { getProviderQuotaStatus } from '../lib/provider-status';
import { resetUserPreferences } from '../lib/preferences';
import { getManagedExportFile, getWebChatSkills, handleWebChat } from '../lib/web-chat';
import { getAgentReachStatus } from '../lib/agent-reach';
import {
  clearWebSession,
  consumeOAuthState,
  createGoogleAuthUrl,
  createWebSessionFromGoogle,
  getWebSession,
  isGoogleAuthConfigured,
  type WebSession,
} from '../lib/web-auth';
import { db } from '../db';
import { users, messages, telemetryEvents, webUsers } from '../db/schema';
import { count, desc, eq } from 'drizzle-orm';
import {
  appendWebChatLog,
  consumeWebChatQuota,
  getWebQuotaStatus,
  getManagedWebUserLogs,
  getWebUserByEmail,
  isWebProfileComplete,
  listManagedWebUsers,
  saveWebUserProfile,
  syncWebUserAccount,
  toWebQuotaStatus,
  updateManagedWebUser,
  WEB_CHAT_QUOTA_LIMIT,
  WEB_CHAT_QUOTA_WINDOW_DAYS,
} from '../lib/web-users';

const app = new Hono();

app.use('*', logger());
app.use('/api/integration/*', cors());

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function requireWebSession(c: Context) {
  const session = await getWebSession(c);
  if (session) {
    return session;
  }

  const nextPath = new URL(c.req.url).pathname;
  c.header('location', `/login?next=${encodeURIComponent(nextPath)}`);
  c.status(302);
  return null;
}

async function requireApiSession(c: Context) {
  const session = await getWebSession(c);
  if (!session) {
    c.status(401);
    return null;
  }

  return session;
}

async function getCurrentWebAccount(session: WebSession | null) {
  if (!session) {
    return null;
  }

  return getWebUserByEmail(session.email);
}

async function requireCompleteWebAccount(c: Context, session: WebSession | null, asApi = false) {
  if (!session) {
    if (asApi) {
      c.status(401);
      return null;
    }
    const nextPath = new URL(c.req.url).pathname;
    c.header('location', `/login?next=${encodeURIComponent(nextPath)}`);
    c.status(302);
    return null;
  }

  const account = await getCurrentWebAccount(session);
  if (!account) {
    if (asApi) {
      return c.json({ error: 'Web account not found' }, 404);
    }
    c.header('location', `/profile/setup`);
    c.status(302);
    return null;
  }

  if (account.suspended) {
    if (asApi) {
      return c.json({ error: 'Account suspended' }, 403);
    }
    clearWebSession(c);
    c.header('location', `/login?error=${encodeURIComponent('Akun dinonaktifkan admin.')}`);
    c.status(302);
    return null;
  }

  if (!isWebProfileComplete(account)) {
    if (asApi) {
      return c.json({ error: 'Profile incomplete' }, 428);
    }
    c.header('location', `/profile/setup`);
    c.status(302);
    return null;
  }

  return account;
}

async function requireAdminPageSession(c: Context) {
  const session = await requireWebSession(c);
  if (!session) {
    return null;
  }

  if (session.role !== 'admin') {
    c.header('location', '/chat');
    c.status(302);
    return null;
  }

  return session;
}

async function requireAdminApiAccess(c: Context) {
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (isValidAdminToken(token)) {
    return { ok: true as const, via: 'token' as const, session: null };
  }

  const session = await getWebSession(c);
  if (!session) {
    return { ok: false as const, status: 401 as const };
  }

  if (session.role !== 'admin') {
    return { ok: false as const, status: 403 as const };
  }

  return { ok: true as const, via: 'session' as const, session };
}

function parseTelemetryPayload(payload: string | null) {
  if (!payload) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function getAssetPath(fileName: string) {
  const assetsDir = join(import.meta.dir, '..', 'assets');
  const allowedAssets = new Map([
    ['cybrabot-logo.png', join(assetsDir, 'cybrabot-logo.png')],
    ['cybrabot-logo.webp', join(assetsDir, 'cybrabot-logo.webp')],
    ['favicon.png', join(assetsDir, 'favicon.png')],
    ['favicon.ico', join(assetsDir, 'favicon.ico')],
  ]);

  return allowedAssets.get(fileName) || null;
}

function getAssetContentType(fileName: string) {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function buildTelemetrySummaries(items: typeof telemetryEvents.$inferSelect[]) {
  const parsedTelemetry = items.map((item) => ({
    item,
    payload: parseTelemetryPayload(item.payload),
  }));

  const intentCounts = parsedTelemetry
    .filter(({ item }) => item.event === 'message.intent_classified')
    .reduce<Record<string, number>>((acc, entry) => {
      const intent = typeof entry.payload.intent === 'string' ? entry.payload.intent : 'unknown';
      acc[intent] = (acc[intent] || 0) + 1;
      return acc;
    }, {});

  const toolCounts = parsedTelemetry
    .filter(({ item }) => item.event === 'message.tool_used')
    .reduce<Record<string, number>>((acc, entry) => {
      const toolName = typeof entry.payload.toolName === 'string' ? entry.payload.toolName : 'unknown';
      acc[toolName] = (acc[toolName] || 0) + 1;
      return acc;
    }, {});

  const aiEvents = parsedTelemetry
    .map((entry) => ({
      item: entry.item,
      payload: entry.payload as {
        latencyMs?: number;
        knowledgeMatches?: string[];
        fallback?: boolean;
      }
    }))
    .filter(({ item }) => item.event === 'message.ai_used');

  const averageAiLatency = aiEvents.length
    ? Math.round(aiEvents.reduce((sum, entry) => sum + (entry.payload.latencyMs || 0), 0) / aiEvents.length)
    : 0;
  const fallbackCount = aiEvents.filter((entry) => entry.payload.fallback).length;
  const knowledgeCounts = aiEvents.reduce<Record<string, number>>((acc, entry) => {
    for (const knowledgeId of entry.payload.knowledgeMatches || []) {
      acc[knowledgeId] = (acc[knowledgeId] || 0) + 1;
    }
    return acc;
  }, {});

  const completionEvents = parsedTelemetry
    .filter(({ item }) => item.event === 'message.completed')
    .map(({ item, payload }) => ({
      createdAt: item.createdAt,
      route: typeof payload.route === 'string' ? payload.route : 'unknown',
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
      userId: typeof payload.userId === 'number' ? payload.userId : null,
    }));

  const routeStats = completionEvents.reduce<Record<string, { count: number; totalDuration: number }>>((acc, entry) => {
    if (!acc[entry.route]) {
      acc[entry.route] = { count: 0, totalDuration: 0 };
    }
    const routeStat = acc[entry.route];
    if (routeStat) {
      routeStat.count += 1;
      routeStat.totalDuration += entry.durationMs;
    }
    return acc;
  }, {});

  const routeBreakdown = Object.entries(routeStats)
    .map(([route, stats]) => ({
      route,
      count: stats.count,
      avgDurationMs: stats.count ? Math.round(stats.totalDuration / stats.count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const recentFailures = parsedTelemetry
    .filter(({ item }) => item.event === 'message.failed')
    .slice(0, 10)
    .map(({ item, payload }) => ({
      createdAt: item.createdAt?.toISOString?.() || null,
      userId: typeof payload.userId === 'number' ? payload.userId : null,
      chatId: typeof payload.chatId === 'number' ? payload.chatId : null,
      error: typeof payload.error === 'string' ? payload.error : 'Unknown error',
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
    }));

  return {
    intentCounts,
    toolCounts,
    averageAiLatency,
    fallbackCount,
    knowledgeCounts,
    routeBreakdown,
    recentFailures,
  };
}

async function getTopUsers(limit = 10) {
  const userMessages = await db.query.messages.findMany({
    where: undefined,
    with: {
      user: true,
    },
  });

  const stats = userMessages.reduce<Record<number, {
    userId: number;
    username: string | null;
    firstName: string | null;
    messageCount: number;
    botReplyCount: number;
    lastSeenAt: Date | null;
  }>>((acc, message) => {
    if (!message.userId) {
      return acc;
    }

    const existing = acc[message.userId] || {
      userId: message.userId,
      username: message.user?.username ?? null,
      firstName: message.user?.firstName ?? null,
      messageCount: 0,
      botReplyCount: 0,
      lastSeenAt: null,
    };

    if (message.role === 'user') {
      existing.messageCount += 1;
    }

    if (message.role === 'bot') {
      existing.botReplyCount += 1;
    }

    if (!existing.lastSeenAt || (message.timestamp && message.timestamp > existing.lastSeenAt)) {
      existing.lastSeenAt = message.timestamp ?? existing.lastSeenAt;
    }

    acc[message.userId] = existing;
    return acc;
  }, {});

  return Object.values(stats)
    .sort((a, b) => b.messageCount - a.messageCount || b.botReplyCount - a.botReplyCount)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      lastSeenAt: item.lastSeenAt?.toISOString?.() || null,
    }));
}

function renderLoginPage(options: {
  nextPath?: string;
  error?: string;
  configured: boolean;
}) {
  const nextPath = options.nextPath?.startsWith('/') ? options.nextPath : '/chat';
  const loginUrl = `/auth/google?next=${encodeURIComponent(nextPath)}`;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login | CybraFeriBot</title>
      <link rel="icon" type="image/png" href="/assets/favicon.png">
      <link rel="icon" type="image/x-icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/assets/favicon.png">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #07111b;
          --panel: rgba(13, 25, 39, 0.88);
          --line: rgba(255,255,255,0.08);
          --text: #f8fafc;
          --muted: rgba(226,232,240,0.7);
          --accent: #2563eb;
          --accent-2: #0f172a;
          --danger: #fca5a5;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          background:
            radial-gradient(circle at top left, rgba(37,99,235,0.2), transparent 34%),
            radial-gradient(circle at bottom right, rgba(14,165,233,0.16), transparent 30%),
            var(--bg);
        }
        .panel {
          width: min(100%, 420px);
          padding: 28px;
          border: 1px solid var(--line);
          border-radius: 20px;
          background: var(--panel);
          box-shadow: 0 28px 60px rgba(0, 0, 0, 0.32);
        }
        .eyebrow {
          font-size: 12px;
          letter-spacing: 0.16em;
          color: #93c5fd;
          text-transform: uppercase;
          font-weight: 700;
        }
        h1 {
          margin: 10px 0 8px;
          font-size: 34px;
          line-height: 1.05;
        }
        .hero-logo {
          display: block;
          width: min(220px, 62vw);
          height: auto;
          margin: 16px auto 12px;
          filter: drop-shadow(0 18px 34px rgba(14, 165, 233, 0.18));
        }
        p {
          margin: 0;
          color: var(--muted);
          line-height: 1.6;
          font-size: 14px;
        }
        .status {
          margin-top: 18px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(252,165,165,0.22);
          background: rgba(127,29,29,0.18);
          color: var(--danger);
          font-size: 13px;
        }
        .actions {
          margin-top: 24px;
          display: grid;
          gap: 12px;
        }
        .google-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          min-height: 48px;
          padding: 0 16px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(145deg, #2563eb, #1d4ed8);
          color: white;
          font: inherit;
          font-weight: 600;
          text-decoration: none;
        }
        .google-button[aria-disabled="true"] {
          opacity: 0.5;
          pointer-events: none;
        }
        .footer {
          margin-top: 18px;
          color: rgba(226,232,240,0.5);
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <main class="panel">
        <div class="eyebrow">CybraFeriBot</div>
        <h1>Masuk dengan Google</h1>
        <img class="hero-logo" src="/assets/cybrabot-logo.png" alt="CybraFeriBot logo">
        ${options.error ? `<div class="status">${escapeHtml(options.error)}</div>` : ''}
        ${!options.configured ? '<div class="status">Google OAuth belum dikonfigurasi. Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET terlebih dahulu.</div>' : ''}
        <div class="actions">
          <a class="google-button" href="${escapeHtml(loginUrl)}" aria-disabled="${options.configured ? 'false' : 'true'}">
            <span>Google</span>
            <span>Lanjutkan ke aplikasi</span>
          </a>
        </div>
        <div class="footer">Dibuat dengan ❤️ oleh Ferilee, 2026</div>
      </main>
    </body>
    </html>
  `;
}

function renderProfileSetupPage(session: WebSession, options?: { error?: string }) {
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Lengkapi Profil | CybraFeriBot</title>
      <link rel="icon" type="image/png" href="/assets/favicon.png">
      <link rel="icon" type="image/x-icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/assets/favicon.png">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #07111b;
          --panel: rgba(13, 25, 39, 0.92);
          --line: rgba(255,255,255,0.08);
          --text: #f8fafc;
          --muted: rgba(226,232,240,0.7);
          --accent: #2563eb;
          --danger: #fca5a5;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          padding: 24px;
          display: grid;
          place-items: center;
          font-family: 'Outfit', sans-serif;
          color: var(--text);
          background:
            radial-gradient(circle at top left, rgba(37,99,235,0.2), transparent 34%),
            radial-gradient(circle at bottom right, rgba(14,165,233,0.16), transparent 30%),
            var(--bg);
        }
        .panel {
          width: min(100%, 720px);
          padding: 28px;
          border: 1px solid var(--line);
          border-radius: 24px;
          background: var(--panel);
          box-shadow: 0 28px 60px rgba(0, 0, 0, 0.32);
        }
        h1 { margin: 10px 0 8px; font-size: 34px; line-height: 1.05; }
        p { margin: 0; color: var(--muted); line-height: 1.6; font-size: 14px; }
        .eyebrow { font-size: 12px; letter-spacing: 0.16em; color: #93c5fd; text-transform: uppercase; font-weight: 700; }
        .hero-logo { display: block; width: 140px; height: auto; margin: 16px auto 18px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 22px; }
        .full { grid-column: 1 / -1; }
        label { display: block; color: var(--muted); font-size: 13px; }
        input, select, button {
          width: 100%;
          font: inherit;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.1);
        }
        input, select {
          margin-top: 8px;
          padding: 12px 14px;
          color: var(--text);
          background: rgba(7,17,27,0.76);
        }
        button {
          margin-top: 22px;
          min-height: 50px;
          border: 0;
          color: white;
          font-weight: 700;
          background: linear-gradient(145deg, #2563eb, #1d4ed8);
          cursor: pointer;
        }
        button:disabled { opacity: 0.55; cursor: progress; }
        .status {
          margin-top: 18px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(252,165,165,0.22);
          background: rgba(127,29,29,0.18);
          color: var(--danger);
          font-size: 13px;
        }
        .mini {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: rgba(226,232,240,0.56);
          font-size: 12px;
        }
        @media (max-width: 680px) {
          .grid { grid-template-columns: 1fr; }
          .full { grid-column: auto; }
        }
      </style>
    </head>
    <body>
      <main class="panel">
        <div class="eyebrow">Profil Pertama</div>
        <h1>Lengkapi profil dulu</h1>
        <img class="hero-logo" src="/assets/cybrabot-logo.png" alt="CybraFeriBot logo">
        <p>Akun <strong>${escapeHtml(session.email)}</strong> perlu melengkapi profil sebelum memakai aplikasi. Data wilayah memakai API statis wilayah Indonesia.</p>
        ${options?.error ? `<div class="status">${escapeHtml(options.error)}</div>` : ''}
        <form id="profileForm">
          <div class="grid">
            <label class="full">
              Nama lengkap
              <input id="fullName" name="fullName" type="text" required value="${escapeHtml(session.name)}" />
            </label>
            <label>
              Provinsi
              <select id="province" name="provinceId" required><option value="">Memuat provinsi...</option></select>
            </label>
            <label>
              Kabupaten / Kota
              <select id="regency" name="regencyId" required disabled><option value="">Pilih provinsi dulu</option></select>
            </label>
            <label>
              Kecamatan
              <select id="district" name="districtId" required disabled><option value="">Pilih kabupaten / kota dulu</option></select>
            </label>
            <label>
              Kelurahan / Desa
              <select id="village" name="villageId" required disabled><option value="">Pilih kecamatan dulu</option></select>
            </label>
          </div>
          <button id="submitButton" type="submit">Simpan Profil dan Lanjutkan</button>
          <div class="mini">
            <span>Gratis 5 obrolan per 3 hari</span>
            <span>Reset otomatis hari ke-4 dan kelipatannya</span>
          </div>
        </form>
      </main>
      <script>
        const form = document.getElementById('profileForm');
        const submitButton = document.getElementById('submitButton');
        const province = document.getElementById('province');
        const regency = document.getElementById('regency');
        const district = document.getElementById('district');
        const village = document.getElementById('village');

        function setOptions(target, items, placeholder) {
          target.innerHTML = '<option value="">' + placeholder + '</option>' + items.map((item) => (
            '<option value="' + String(item.id) + '">' + String(item.name) + '</option>'
          )).join('');
          target.disabled = false;
        }

        async function fetchRegions(path) {
          const response = await fetch(path);
          if (!response.ok) throw new Error('Gagal memuat data wilayah.');
          return response.json();
        }

        async function loadProvinces() {
          const items = await fetchRegions('/api/regions/provinces');
          setOptions(province, items, 'Pilih provinsi');
        }

        province.addEventListener('change', async () => {
          regency.disabled = true;
          district.disabled = true;
          village.disabled = true;
          regency.innerHTML = '<option value="">Memuat kabupaten / kota...</option>';
          district.innerHTML = '<option value="">Pilih kabupaten / kota dulu</option>';
          village.innerHTML = '<option value="">Pilih kecamatan dulu</option>';
          if (!province.value) return;
          const items = await fetchRegions('/api/regions/regencies/' + encodeURIComponent(province.value));
          setOptions(regency, items, 'Pilih kabupaten / kota');
        });

        regency.addEventListener('change', async () => {
          district.disabled = true;
          village.disabled = true;
          district.innerHTML = '<option value="">Memuat kecamatan...</option>';
          village.innerHTML = '<option value="">Pilih kecamatan dulu</option>';
          if (!regency.value) return;
          const items = await fetchRegions('/api/regions/districts/' + encodeURIComponent(regency.value));
          setOptions(district, items, 'Pilih kecamatan');
        });

        district.addEventListener('change', async () => {
          village.disabled = true;
          village.innerHTML = '<option value="">Memuat kelurahan / desa...</option>';
          if (!district.value) return;
          const items = await fetchRegions('/api/regions/villages/' + encodeURIComponent(district.value));
          setOptions(village, items, 'Pilih kelurahan / desa');
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          submitButton.disabled = true;
          const formData = new FormData(form);
          const payload = Object.fromEntries(formData.entries());

          payload.provinceName = province.options[province.selectedIndex]?.text || '';
          payload.regencyName = regency.options[regency.selectedIndex]?.text || '';
          payload.districtName = district.options[district.selectedIndex]?.text || '';
          payload.villageName = village.options[village.selectedIndex]?.text || '';

          const response = await fetch('/api/profile/setup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            alert(data.error || 'Gagal menyimpan profil.');
            submitButton.disabled = false;
            return;
          }
          window.location.href = '${escapeHtml('/chat')}';
        });

        loadProvinces().catch(() => {
          province.innerHTML = '<option value="">Gagal memuat provinsi</option>';
        });
      </script>
    </body>
    </html>
  `;
}

function renderAdminPage(session: WebSession) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CybraFeriBot Admin</title>
      <link rel="icon" type="image/png" href="/assets/favicon.png">
      <link rel="icon" type="image/x-icon" href="/favicon.ico">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --primary: #6366f1;
          --secondary: #a855f7;
          --bg: #0f172a;
          --panel: rgba(30, 41, 59, 0.78);
          --text: #f8fafc;
          --muted: rgba(248, 250, 252, 0.72);
          --danger: #ef4444;
          --ok: #22c55e;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: 'Outfit', sans-serif;
          background: radial-gradient(circle at top left, #1e1b4b, #0f172a);
          color: var(--text);
          min-height: 100vh;
          padding: 2rem;
        }
        .container {
          max-width: 1100px;
          margin: 0 auto;
        }
        .panel {
          background: var(--panel);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }
        h1, h2, h3 { margin-top: 0; }
        label {
          display: block;
          margin-bottom: 0.75rem;
          color: var(--muted);
          font-size: 0.95rem;
        }
        input[type="text"], input[type="password"], input[type="number"], textarea {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.8);
          color: var(--text);
          padding: 0.8rem 0.9rem;
          font: inherit;
          margin-top: 0.35rem;
        }
        textarea { min-height: 130px; resize: vertical; }
        .row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
        }
        .toolbar {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin-top: 1rem;
        }
        button {
          border: 0;
          border-radius: 12px;
          padding: 0.8rem 1rem;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
          color: white;
          background: linear-gradient(to right, var(--primary), var(--secondary));
        }
        button.secondary {
          background: rgba(255,255,255,0.08);
        }
        button.danger {
          background: var(--danger);
        }
        .checkboxes label {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 0.4rem;
          color: var(--text);
        }
        .list {
          display: grid;
          gap: 0.75rem;
          max-height: 420px;
          overflow: auto;
        }
        .dense-list {
          max-height: 560px;
        }
        .conversation-log {
          display: grid;
          gap: 0.7rem;
          max-height: 460px;
          overflow: auto;
        }
        .item {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 0.9rem;
          background: rgba(15, 23, 42, 0.5);
        }
        .item p {
          margin: 0.4rem 0 0;
          color: var(--muted);
          white-space: pre-wrap;
        }
        .status {
          margin-top: 0.75rem;
          color: var(--muted);
          font-size: 0.95rem;
        }
        .status.ok { color: var(--ok); }
        .status.error { color: #fca5a5; }
        .hint {
          color: var(--muted);
          font-size: 0.95rem;
        }
        .compact-input {
          min-width: 220px;
          flex: 1 1 240px;
          margin-top: 0;
        }
        .user-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 0.9rem;
        }
        .user-card {
          display: grid;
          gap: 0.8rem;
        }
        .user-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 0.8rem;
          align-items: start;
        }
        .user-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
        }
        .user-avatar-fallback {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          font-size: 0.85rem;
          font-weight: 700;
          color: white;
          border: 1px solid rgba(255,255,255,0.14);
          background: linear-gradient(145deg, rgba(99,102,241,0.9), rgba(168,85,247,0.9));
        }
        .badge-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          margin-top: 0.45rem;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.3rem 0.55rem;
          border-radius: 999px;
          font-size: 0.74rem;
          font-weight: 600;
          border: 1px solid rgba(255,255,255,0.1);
          color: rgba(248,250,252,0.86);
          background: rgba(255,255,255,0.05);
        }
        .badge.ok {
          color: #bbf7d0;
          border-color: rgba(34,197,94,0.22);
          background: rgba(20,83,45,0.4);
        }
        .badge.warn {
          color: #fde68a;
          border-color: rgba(245,158,11,0.22);
          background: rgba(120,53,15,0.35);
        }
        .badge.danger {
          color: #fecaca;
          border-color: rgba(239,68,68,0.22);
          background: rgba(127,29,29,0.35);
        }
        .mini-stat {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.55rem;
        }
        .mini-stat > div {
          padding: 0.6rem 0.7rem;
          border-radius: 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .mini-stat strong {
          display: block;
          font-size: 0.95rem;
        }
        .mini-stat span {
          display: block;
          margin-top: 0.18rem;
          color: var(--muted);
          font-size: 0.72rem;
        }
        .pager {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          margin-top: 0.9rem;
        }
        .pager-info {
          color: var(--muted);
          font-size: 0.86rem;
        }
        .log-bubble {
          padding: 0.8rem 0.9rem;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
        }
        .log-bubble.user {
          background: rgba(59,130,246,0.12);
          border-color: rgba(96,165,250,0.2);
        }
        .log-bubble.assistant {
          background: rgba(168,85,247,0.10);
          border-color: rgba(192,132,252,0.18);
        }
        .log-meta {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.45rem;
          color: var(--muted);
          font-size: 0.78rem;
        }
        .empty-state {
          padding: 1rem;
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
          color: var(--muted);
          font-size: 0.92rem;
        }
        a { color: #a5b4fc; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="panel">
          <div class="row" style="justify-content: space-between;">
            <div>
              <div style="letter-spacing: 4px; color: #818cf8; font-size: 0.85rem; font-weight: 600;">ADMIN CONSOLE</div>
              <h1>CybraFeriBot Runtime Control</h1>
              <p class="hint">Masuk sebagai ${escapeHtml(session.email)}. Session admin Google bisa langsung memakai endpoint admin, dan token manual tetap didukung untuk fallback.</p>
            </div>
            <div class="row">
              <a href="/dashboard">Dashboard</a>
              <a href="/chat">Web chat</a>
              <a href="/logout">Logout</a>
            </div>
          </div>
          <label>
            Admin token opsional
            <input id="adminToken" type="password" placeholder="Kosongkan jika memakai session admin Google" />
          </label>
          <div class="toolbar">
            <button id="loadAllButton" type="button">Load Current State</button>
          </div>
          <div id="globalStatus" class="status"></div>
        </div>

        <div class="grid">
          <div class="panel">
            <h2>Runtime Config</h2>
            <div class="checkboxes">
              <label><input id="toolMath" type="checkbox" /> Math tool</label>
              <label><input id="toolCaption" type="checkbox" /> Caption tool</label>
              <label><input id="toolAnnouncement" type="checkbox" /> Announcement tool</label>
              <label><input id="toolFaq" type="checkbox" /> FAQ tool</label>
            </div>
            <label>
              Persona override
              <textarea id="personaOverride" placeholder="Mis. Jawablah lebih formal untuk konteks sekolah."></textarea>
            </label>
            <div class="toolbar">
              <button id="saveConfigButton" type="button">Save Config</button>
            </div>
            <div id="configStatus" class="status"></div>
          </div>

          <div class="panel">
            <h2>Self Describe Templates</h2>
            <label>
              Identity
              <textarea id="selfDescribeIdentity" placeholder="Deskripsi umum CybraFeriBot"></textarea>
            </label>
            <label>
              Features
              <textarea id="selfDescribeFeatures" placeholder="Daftar fitur utama bot"></textarea>
            </label>
            <label>
              Workflow
              <textarea id="selfDescribeWorkflow" placeholder="Penjelasan cara kerja bot"></textarea>
            </label>
            <label>
              Improvement
              <textarea id="selfDescribeImprovement" placeholder="Penjelasan arah peningkatan kemampuan bot"></textarea>
            </label>
          </div>

          <div class="panel">
            <h2>Response Templates</h2>
            <p class="hint">Perubahan langsung berlaku tanpa rebuild. HTML Telegram sederhana seperti &lt;b&gt;...&lt;/b&gt; boleh dipakai.</p>
            <label>
              Status pembuatan Markdown
              <textarea id="responseMarkdownProcessing" placeholder="Pesan ketika file Markdown sedang dibuat"></textarea>
            </label>
            <label>
              Status pemrosesan dokumen
              <textarea id="responseDocumentProcessing" placeholder="Gunakan {{fileName}} untuk nama file"></textarea>
            </label>
            <label>
              Error AI
              <textarea id="responseAiError" placeholder="Pesan ketika provider AI gagal"></textarea>
            </label>
            <label>
              Error dokumen
              <textarea id="responseDocumentError" placeholder="Pesan ketika file gagal diproses"></textarea>
            </label>
            <label>
              Error ekspor
              <textarea id="responseExportError" placeholder="Pesan ketika file gagal dibuat"></textarea>
            </label>
            <div class="toolbar">
              <button id="saveResponsesButton" type="button">Save Response Templates</button>
            </div>
            <div id="responseStatus" class="status"></div>
          </div>

          <div class="panel">
            <h2>Reset User Preferences</h2>
            <label>
              User ID Telegram
              <input id="resetUserId" type="number" placeholder="123456789" />
            </label>
            <div class="toolbar">
              <button id="resetPreferencesButton" type="button" class="danger">Reset Preferences</button>
            </div>
            <div id="preferencesStatus" class="status"></div>
          </div>
        </div>

        <div class="panel">
          <h2>Provider Quota</h2>
          <div class="toolbar" style="margin-top: 0;">
            <button id="loadQuotaButton" type="button" class="secondary">Refresh Quota</button>
          </div>
          <div id="quotaStatus" class="status">Belum dimuat.</div>
          <div id="quotaDetail" class="item" style="margin-top: 1rem; display: none;"></div>
        </div>

        <div class="grid">
          <div class="panel">
            <h2>Analytics</h2>
            <div id="routeList" class="list">
              <div class="hint">Belum dimuat.</div>
            </div>
          </div>

          <div class="panel">
            <h2>Top Users</h2>
            <div id="topUsersList" class="list">
              <div class="hint">Belum dimuat.</div>
            </div>
          </div>
        </div>

        <div class="panel">
          <h2>Web Users</h2>
          <p class="hint">Kelola user Google web: lihat profil, status akun, kuota aktif, dan reset jatah obrolan.</p>
          <div class="toolbar" style="margin-top:0.8rem;">
            <input id="webUserSearch" class="compact-input" type="text" placeholder="Cari nama, email, atau wilayah" />
            <select id="webUserStatusFilter" class="compact-input">
              <option value="all">Semua status</option>
              <option value="active">Aktif</option>
              <option value="suspended">Suspended</option>
              <option value="incomplete">Profil belum lengkap</option>
              <option value="quota_exhausted">Kuota habis</option>
            </select>
          </div>
          <div id="webUsersList" class="list dense-list">
            <div class="hint">Belum dimuat.</div>
          </div>
          <div class="pager">
            <div id="webUsersPagerInfo" class="pager-info">0 user</div>
            <div class="row">
              <button id="webUsersPrevPage" type="button" class="secondary">Sebelumnya</button>
              <button id="webUsersNextPage" type="button" class="secondary">Berikutnya</button>
            </div>
          </div>
        </div>

        <div class="panel">
          <h2>Web User Detail</h2>
          <div id="selectedWebUser" class="empty-state">Pilih salah satu user web untuk melihat statistik pemakaian dan log percakapannya.</div>
          <div id="selectedWebUserLogs" class="conversation-log" style="margin-top:1rem; display:none;"></div>
        </div>

        <div class="grid">
          <div class="panel">
            <h2>Knowledge Editor</h2>
            <label>
              Document ID
              <input id="knowledgeId" type="text" placeholder="Kosongkan untuk auto-generate dari title" />
            </label>
            <label>
              Title
              <input id="knowledgeTitle" type="text" placeholder="Judul dokumen knowledge" />
            </label>
            <label>
              Content
              <textarea id="knowledgeContent" placeholder="Isi dokumen knowledge"></textarea>
            </label>
            <div class="toolbar">
              <button id="saveKnowledgeButton" type="button">Save Knowledge</button>
              <button id="clearKnowledgeButton" type="button" class="secondary">Clear Form</button>
            </div>
            <div id="knowledgeStatus" class="status"></div>
          </div>

          <div class="panel">
            <h2>Knowledge Documents</h2>
            <div id="knowledgeList" class="list">
              <div class="hint">Belum dimuat.</div>
            </div>
          </div>
        </div>

        <div class="panel">
          <h2>Recent Failures</h2>
          <div id="failureList" class="list">
            <div class="hint">Belum dimuat.</div>
          </div>
        </div>
      </div>

      <script>
        const params = new URLSearchParams(window.location.search);
        const tokenInput = document.getElementById('adminToken');
        const globalStatus = document.getElementById('globalStatus');
        const configStatus = document.getElementById('configStatus');
        const responseStatus = document.getElementById('responseStatus');
        const knowledgeStatus = document.getElementById('knowledgeStatus');
        const preferencesStatus = document.getElementById('preferencesStatus');
        const quotaStatus = document.getElementById('quotaStatus');
        const quotaDetail = document.getElementById('quotaDetail');
        const knowledgeList = document.getElementById('knowledgeList');
        const routeList = document.getElementById('routeList');
        const topUsersList = document.getElementById('topUsersList');
        const failureList = document.getElementById('failureList');
        const webUsersList = document.getElementById('webUsersList');
        const webUserSearch = document.getElementById('webUserSearch');
        const webUserStatusFilter = document.getElementById('webUserStatusFilter');
        const webUsersPagerInfo = document.getElementById('webUsersPagerInfo');
        const webUsersPrevPage = document.getElementById('webUsersPrevPage');
        const webUsersNextPage = document.getElementById('webUsersNextPage');
        const selectedWebUser = document.getElementById('selectedWebUser');
        const selectedWebUserLogs = document.getElementById('selectedWebUserLogs');
        let cachedWebUsers = [];
        let webUsersPage = 1;
        const WEB_USERS_PAGE_SIZE = 8;

        tokenInput.value = params.get('token') || '';

        function setStatus(target, message, type = '') {
          target.className = 'status' + (type ? ' ' + type : '');
          target.textContent = message;
        }

        function adminUrl(path) {
          const token = tokenInput.value.trim();
          if (!token) {
            return path;
          }
          return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
        }

        function escapeHtml(value) {
          return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        async function api(path, options = {}) {
          const response = await fetch(adminUrl(path), options);
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error || 'Request failed');
          }
          return data;
        }

        async function loadConfig() {
          const data = await api('/admin/config');
          document.getElementById('toolMath').checked = Boolean(data.enabledTools?.math);
          document.getElementById('toolCaption').checked = Boolean(data.enabledTools?.caption);
          document.getElementById('toolAnnouncement').checked = Boolean(data.enabledTools?.announcement);
          document.getElementById('toolFaq').checked = Boolean(data.enabledTools?.faq);
          document.getElementById('personaOverride').value = data.personaOverride || '';
          document.getElementById('selfDescribeIdentity').value = data.selfDescribe?.identity || '';
          document.getElementById('selfDescribeFeatures').value = data.selfDescribe?.features || '';
          document.getElementById('selfDescribeWorkflow').value = data.selfDescribe?.workflow || '';
          document.getElementById('selfDescribeImprovement').value = data.selfDescribe?.improvement || '';
          document.getElementById('responseMarkdownProcessing').value = data.responseTemplates?.markdownProcessing || '';
          document.getElementById('responseDocumentProcessing').value = data.responseTemplates?.documentProcessing || '';
          document.getElementById('responseAiError').value = data.responseTemplates?.aiError || '';
          document.getElementById('responseDocumentError').value = data.responseTemplates?.documentError || '';
          document.getElementById('responseExportError').value = data.responseTemplates?.exportError || '';
        }

        async function loadKnowledge() {
          const data = await api('/admin/knowledge');
          const items = Array.isArray(data.items) ? data.items : [];
          if (!items.length) {
            knowledgeList.innerHTML = '<div class="hint">Belum ada dokumen knowledge.</div>';
            return;
          }
          knowledgeList.innerHTML = items.map((item) => {
            const preview = (item.content || '').slice(0, 220);
            return \`
              <div class="item">
                <div class="row" style="justify-content: space-between; align-items: flex-start;">
                  <div>
                    <strong>\${escapeHtml(item.title || item.id)}</strong>
                    <div class="hint">\${escapeHtml(item.id || '')}</div>
                  </div>
                  <div class="row">
                    <button type="button" class="secondary" onclick="editKnowledge(\${JSON.stringify(item).replace(/"/g, '&quot;')})">Edit</button>
                    <button type="button" class="danger" onclick="deleteKnowledge('\${escapeHtml(item.id)}')">Delete</button>
                  </div>
                </div>
                <p>\${escapeHtml(preview)}\${(item.content || '').length > 220 ? '...' : ''}</p>
              </div>
            \`;
          }).join('');
        }

        async function loadInsights() {
          const data = await api('/admin/insights');
          const routes = Array.isArray(data.routeBreakdown) ? data.routeBreakdown : [];
          const topUsers = Array.isArray(data.topUsers) ? data.topUsers : [];
          const failures = Array.isArray(data.recentFailures) ? data.recentFailures : [];

          routeList.innerHTML = routes.length
            ? routes.map((item) => \`
                <div class="item">
                  <div class="row" style="justify-content: space-between;">
                    <strong>\${escapeHtml(item.route || 'unknown')}</strong>
                    <span>\${item.count || 0} hits</span>
                  </div>
                  <p>Avg duration: \${item.avgDurationMs || 0} ms</p>
                </div>
              \`).join('')
            : '<div class="hint">Belum ada data route.</div>';

          topUsersList.innerHTML = topUsers.length
            ? topUsers.map((item) => \`
                <div class="item">
                  <div class="row" style="justify-content: space-between;">
                    <strong>\${escapeHtml(item.firstName || item.username || String(item.userId))}</strong>
                    <span>\${item.messageCount || 0} pesan user</span>
                  </div>
                  <p>User ID: \${item.userId} | Bot replies: \${item.botReplyCount || 0}</p>
                </div>
              \`).join('')
            : '<div class="hint">Belum ada data user.</div>';

          failureList.innerHTML = failures.length
            ? failures.map((item) => \`
                <div class="item">
                  <div class="row" style="justify-content: space-between;">
                    <strong>User: \${item.userId || '-'}</strong>
                    <span>\${escapeHtml(item.createdAt || '-')}</span>
                  </div>
                  <p>\${escapeHtml(item.error || 'Unknown error')}</p>
                </div>
              \`).join('')
            : '<div class="hint">Belum ada failure yang terekam.</div>';
        }

        async function loadWebUsers() {
          const data = await api('/admin/users');
          cachedWebUsers = Array.isArray(data.items) ? data.items : [];
          renderWebUsers();
        }

        function renderWebUsers() {
          const query = String(webUserSearch.value || '').trim().toLowerCase();
          const filter = String(webUserStatusFilter.value || 'all');
          const filtered = cachedWebUsers.filter((item) => {
            const haystack = [
              item.fullName,
              item.googleName,
              item.email,
              item.region,
            ].filter(Boolean).join(' ').toLowerCase();

            if (query && !haystack.includes(query)) {
              return false;
            }

            if (filter === 'active' && item.suspended) return false;
            if (filter === 'suspended' && !item.suspended) return false;
            if (filter === 'incomplete' && item.profileCompleted) return false;
            if (filter === 'quota_exhausted' && Number(item.quota?.remaining || 0) > 0) return false;
            return true;
          });

          const totalPages = Math.max(1, Math.ceil(filtered.length / WEB_USERS_PAGE_SIZE));
          webUsersPage = Math.min(totalPages, Math.max(1, webUsersPage));
          const startIndex = (webUsersPage - 1) * WEB_USERS_PAGE_SIZE;
          const items = filtered.slice(startIndex, startIndex + WEB_USERS_PAGE_SIZE);
          webUsersPagerInfo.textContent = filtered.length
            ? 'Menampilkan ' + (startIndex + 1) + '-' + (startIndex + items.length) + ' dari ' + filtered.length + ' user'
            : '0 user';
          webUsersPrevPage.disabled = webUsersPage <= 1;
          webUsersNextPage.disabled = webUsersPage >= totalPages;

          webUsersList.innerHTML = items.length
            ? '<div class="user-grid">' + items.map((item) => {
                const displayName = item.fullName || item.googleName || item.email;
                const initials = String(displayName).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'U';
                const avatar = item.picture
                  ? '<img class="user-avatar" src="' + escapeHtml(item.picture) + '" alt="' + escapeHtml(displayName) + '">'
                  : '<div class="user-avatar-fallback">' + escapeHtml(initials) + '</div>';
                const resetText = item.quota?.resetsAt ? new Date(item.quota.resetsAt).toLocaleString('id-ID') : '-';
                return \`
                  <div class="item user-card">
                    <div class="user-header">
                      \${avatar}
                      <div style="min-width:0;">
                        <strong style="display:block;overflow-wrap:anywhere;">\${escapeHtml(displayName)}</strong>
                        <div class="hint" style="overflow-wrap:anywhere;">\${escapeHtml(item.email)}</div>
                        <div class="hint" style="margin-top:0.25rem;">\${escapeHtml(item.region || 'Wilayah belum diisi')}</div>
                        <div class="badge-row">
                          <span class="badge">\${escapeHtml(item.role || 'visitor')}</span>
                          <span class="badge \${item.profileCompleted ? 'ok' : 'warn'}">\${item.profileCompleted ? 'profil lengkap' : 'profil belum lengkap'}</span>
                          <span class="badge \${item.suspended ? 'danger' : 'ok'}">\${item.suspended ? 'suspended' : 'aktif'}</span>
                        </div>
                      </div>
                      <div class="row" style="justify-content:flex-end;">
                        <button type="button" class="secondary" onclick="viewWebUserLogs('\${escapeHtml(item.email)}')">Lihat Log</button>
                        <button type="button" class="secondary" onclick="toggleWebUserSuspension('\${escapeHtml(item.email)}', \${item.suspended ? 'false' : 'true'})">\${item.suspended ? 'Aktifkan' : 'Suspend'}</button>
                        <button type="button" onclick="resetWebUserQuota('\${escapeHtml(item.email)}')">Reset Kuota</button>
                      </div>
                    </div>
                    <div class="mini-stat">
                      <div><strong>\${item.quota?.remaining ?? '-'}/\${item.quota?.limit ?? '-'}</strong><span>Sisa chat</span></div>
                      <div><strong>\${item.totalUserMessages ?? 0}</strong><span>Total pemakaian</span></div>
                      <div><strong>\${escapeHtml(resetText)}</strong><span>Reset berikutnya</span></div>
                    </div>
                  </div>
                \`;
              }).join('') + '</div>'
            : '<div class="hint">Tidak ada user yang cocok dengan filter saat ini.</div>';
        }

        window.toggleWebUserSuspension = async (email, suspended) => {
          try {
            setStatus(globalStatus, 'Memperbarui status user...');
            await api('/admin/users/' + encodeURIComponent(email), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ suspended }),
            });
            setStatus(globalStatus, 'Status user diperbarui.', 'ok');
            await loadWebUsers();
          } catch (error) {
            setStatus(globalStatus, error.message, 'error');
          }
        };

        window.resetWebUserQuota = async (email) => {
          try {
            setStatus(globalStatus, 'Mereset kuota user...');
            await api('/admin/users/' + encodeURIComponent(email), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resetQuota: true }),
            });
            setStatus(globalStatus, 'Kuota user berhasil direset.', 'ok');
            await loadWebUsers();
          } catch (error) {
            setStatus(globalStatus, error.message, 'error');
          }
        };

        window.viewWebUserLogs = async (email) => {
          try {
            setStatus(globalStatus, 'Memuat detail user dan log percakapan...');
            const data = await api('/admin/users/' + encodeURIComponent(email) + '/logs');
            const user = data.user || {};
            const logs = Array.isArray(data.logs) ? data.logs : [];
            selectedWebUser.innerHTML = \`
              <div class="item">
                <div class="row" style="justify-content:space-between;align-items:flex-start;">
                  <div>
                    <strong>\${escapeHtml(user.fullName || user.googleName || user.email || '-')}</strong>
                    <div class="hint">\${escapeHtml(user.email || '-')}</div>
                    <div class="hint">\${escapeHtml(user.region || 'Wilayah belum diisi')}</div>
                  </div>
                  <div class="badge-row">
                    <span class="badge">\${escapeHtml(user.role || 'visitor')}</span>
                    <span class="badge \${user.suspended ? 'danger' : 'ok'}">\${user.suspended ? 'suspended' : 'aktif'}</span>
                  </div>
                </div>
                <div class="mini-stat" style="margin-top:0.9rem;">
                  <div><strong>\${escapeHtml(user.joinedAt ? new Date(user.joinedAt).toLocaleString('id-ID') : '-')}</strong><span>Bergabung sejak</span></div>
                  <div><strong>\${user.totalUserMessages ?? 0}</strong><span>Jumlah pemakaian</span></div>
                  <div><strong>\${user.totalAssistantMessages ?? 0}</strong><span>Jawaban Cybra</span></div>
                </div>
              </div>
            \`;

            selectedWebUserLogs.style.display = logs.length ? 'grid' : 'none';
            selectedWebUserLogs.innerHTML = logs.length
              ? logs.map((log) => \`
                  <div class="log-bubble \${escapeHtml(log.role || 'assistant')}">
                    <div class="log-meta">
                      <span>\${escapeHtml(log.role === 'user' ? 'User' : 'Cybra')}</span>
                      <span>\${escapeHtml(log.createdAt ? new Date(log.createdAt).toLocaleString('id-ID') : '-')}</span>
                    </div>
                    <div style="white-space:pre-wrap;overflow-wrap:anywhere;">\${escapeHtml(log.content || '')}</div>
                    <div class="badge-row" style="margin-top:0.6rem;">
                      \${log.route ? '<span class="badge">' + escapeHtml(log.route) + '</span>' : ''}
                      \${log.skillId ? '<span class="badge">' + escapeHtml(log.skillId) + '</span>' : ''}
                      \${log.intent ? '<span class="badge">' + escapeHtml(log.intent) + '</span>' : ''}
                      \${log.model ? '<span class="badge">' + escapeHtml(log.model) + '</span>' : ''}
                    </div>
                  </div>
                \`).join('')
              : '';
            setStatus(globalStatus, 'Detail user berhasil dimuat.', 'ok');
          } catch (error) {
            setStatus(globalStatus, error.message, 'error');
          }
        };

        async function loadQuota() {
          const data = await api('/admin/quota');
          const status = data.providerStatus || {};
          const activeModel = data.activeModel || 'unknown';
          const provider = data.provider || 'unknown';

          if (status.ok) {
            setStatus(quotaStatus, 'Kuota provider berhasil dibaca.', 'ok');
            quotaDetail.style.display = 'block';
            quotaDetail.innerHTML = \`
              <div class="row" style="justify-content: space-between;">
                <strong>\${escapeHtml(provider)} / \${escapeHtml(activeModel)}</strong>
                <span>\${escapeHtml(status.endpoint || '-')}</span>
              </div>
              <p>\${escapeHtml(status.summary || 'No summary')}</p>
            \`;
            return;
          }

          setStatus(quotaStatus, status.summary || 'Kuota provider tidak bisa dibaca.', 'error');
          quotaDetail.style.display = 'block';
          quotaDetail.innerHTML = \`
            <div class="row" style="justify-content: space-between;">
              <strong>\${escapeHtml(provider)} / \${escapeHtml(activeModel)}</strong>
              <span>\${escapeHtml(status.endpoint || '-')}</span>
            </div>
            <p>\${escapeHtml(status.summary || 'No summary')}</p>
          \`;
        }

        window.editKnowledge = (item) => {
          document.getElementById('knowledgeId').value = item.id || '';
          document.getElementById('knowledgeTitle').value = item.title || '';
          document.getElementById('knowledgeContent').value = item.content || '';
          setStatus(knowledgeStatus, 'Form knowledge diisi dari dokumen terpilih.', 'ok');
        };

        window.deleteKnowledge = async (id) => {
          if (!confirm('Hapus knowledge "' + id + '"?')) {
            return;
          }
          try {
            await api('/admin/knowledge/' + encodeURIComponent(id), { method: 'DELETE' });
            setStatus(knowledgeStatus, 'Knowledge berhasil dihapus.', 'ok');
            await loadKnowledge();
          } catch (error) {
            setStatus(knowledgeStatus, error.message, 'error');
          }
        };

        document.getElementById('loadAllButton').addEventListener('click', async () => {
          try {
            setStatus(globalStatus, 'Memuat state runtime...');
            await Promise.all([loadConfig(), loadKnowledge(), loadInsights(), loadQuota(), loadWebUsers()]);
            setStatus(globalStatus, 'State runtime berhasil dimuat.', 'ok');
          } catch (error) {
            setStatus(globalStatus, error.message, 'error');
          }
        });

        async function saveRuntimeConfig() {
          try {
            setStatus(configStatus, 'Menyimpan config...');
            setStatus(responseStatus, 'Menyimpan response templates...');
            const payload = {
              enabledTools: {
                math: document.getElementById('toolMath').checked,
                caption: document.getElementById('toolCaption').checked,
                announcement: document.getElementById('toolAnnouncement').checked,
                faq: document.getElementById('toolFaq').checked,
              },
              personaOverride: document.getElementById('personaOverride').value.trim(),
              selfDescribe: {
                identity: document.getElementById('selfDescribeIdentity').value.trim(),
                features: document.getElementById('selfDescribeFeatures').value.trim(),
                workflow: document.getElementById('selfDescribeWorkflow').value.trim(),
                improvement: document.getElementById('selfDescribeImprovement').value.trim(),
              },
              responseTemplates: {
                markdownProcessing: document.getElementById('responseMarkdownProcessing').value.trim(),
                documentProcessing: document.getElementById('responseDocumentProcessing').value.trim(),
                aiError: document.getElementById('responseAiError').value.trim(),
                documentError: document.getElementById('responseDocumentError').value.trim(),
                exportError: document.getElementById('responseExportError').value.trim(),
              },
            };
            await api('/admin/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            setStatus(configStatus, 'Config runtime berhasil disimpan.', 'ok');
            setStatus(responseStatus, 'Response templates berhasil disimpan dan langsung aktif.', 'ok');
          } catch (error) {
            setStatus(configStatus, error.message, 'error');
            setStatus(responseStatus, error.message, 'error');
          }
        }

        document.getElementById('saveConfigButton').addEventListener('click', saveRuntimeConfig);
        document.getElementById('saveResponsesButton').addEventListener('click', saveRuntimeConfig);

        document.getElementById('saveKnowledgeButton').addEventListener('click', async () => {
          try {
            setStatus(knowledgeStatus, 'Menyimpan knowledge...');
            const payload = {
              id: document.getElementById('knowledgeId').value.trim() || undefined,
              title: document.getElementById('knowledgeTitle').value.trim(),
              content: document.getElementById('knowledgeContent').value.trim(),
            };
            await api('/admin/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            setStatus(knowledgeStatus, 'Knowledge berhasil disimpan.', 'ok');
            await loadKnowledge();
          } catch (error) {
            setStatus(knowledgeStatus, error.message, 'error');
          }
        });

        document.getElementById('clearKnowledgeButton').addEventListener('click', () => {
          document.getElementById('knowledgeId').value = '';
          document.getElementById('knowledgeTitle').value = '';
          document.getElementById('knowledgeContent').value = '';
          setStatus(knowledgeStatus, 'Form knowledge dibersihkan.', 'ok');
        });

        document.getElementById('resetPreferencesButton').addEventListener('click', async () => {
          try {
            setStatus(preferencesStatus, 'Mereset preferensi user...');
            const userId = Number(document.getElementById('resetUserId').value);
            if (!userId) {
              throw new Error('User ID tidak valid.');
            }
            await api('/admin/preferences/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId }),
            });
            setStatus(preferencesStatus, 'Preferensi user berhasil direset.', 'ok');
          } catch (error) {
            setStatus(preferencesStatus, error.message, 'error');
          }
        });

        document.getElementById('loadQuotaButton').addEventListener('click', async () => {
          try {
            setStatus(quotaStatus, 'Memuat status kuota...');
            await loadQuota();
          } catch (error) {
            setStatus(quotaStatus, error.message, 'error');
          }
        });

        webUserSearch.addEventListener('input', renderWebUsers);
        webUserStatusFilter.addEventListener('change', () => {
          webUsersPage = 1;
          renderWebUsers();
        });
        webUsersPrevPage.addEventListener('click', () => {
          webUsersPage = Math.max(1, webUsersPage - 1);
          renderWebUsers();
        });
        webUsersNextPage.addEventListener('click', () => {
          webUsersPage += 1;
          renderWebUsers();
        });
      </script>
    </body>
    </html>
  `;
}

function renderWebChatPage(session: WebSession, account: NonNullable<Awaited<ReturnType<typeof getWebUserByEmail>>>, quota: ReturnType<typeof toWebQuotaStatus>) {
  const displayName = account.fullName || session.name;
  const avatarUrl = account.picture || session.picture || '';
  const avatarInitial = (displayName.trim()[0] || 'C').toUpperCase();
  const limit = Number(quota.limit || 0);
  const remaining = Number(quota.remaining || 0);
  const percentLeft = Math.max(0, Math.min(100, limit ? Math.round((remaining / limit) * 100) : 0));
  const progressWidth = Math.max(0, Math.min(100, limit ? (remaining / limit) * 100 : 0));
  const quotaTone = remaining > 0
    ? 'linear-gradient(90deg,#22d3ee,#34d399)'
    : 'linear-gradient(90deg,#f59e0b,#ef4444)';
  const formatQuotaCountdown = (value?: string | null) => {
    if (!value) return '-';
    const diff = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0) return 'kurang dari 1m';
    const totalMinutes = Math.max(1, Math.floor(diff / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}h`);
    if (hours > 0 || days > 0) parts.push(`${hours}j`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
  };
  const quotaResetLabel = quota.resetsAt
    ? `${formatQuotaCountdown(quota.resetsAt)} • ${new Date(quota.resetsAt).toLocaleString('id-ID')}`
    : '-';
  const adminLinks = session.role === 'admin'
    ? `
          <div class="sidebar-links">
            <a href="/dashboard">Dashboard</a>
            <a href="/admin">Admin</a>
          </div>
      `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="theme-color" content="#17456f">
      <title>CybraFeriBot Web Chat</title>
      <link rel="icon" type="image/png" href="/assets/favicon.png">
      <link rel="icon" type="image/x-icon" href="/favicon.ico">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
      <script defer src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <script defer src="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"></script>
      <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
      <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
      <style>
        :root {
          --sky-top: #72a7d5;
          --sky-mid: #3f78a8;
          --sky-bottom: #173f65;
          --ink: #102333;
          --paper: rgba(247, 249, 250, 0.96);
          --night: rgba(16, 31, 43, 0.94);
          --line: rgba(255, 255, 255, 0.2);
          --muted: rgba(255, 255, 255, 0.68);
          --lime: #95dc59;
          --danger: #ffaaa5;
        }
        * { box-sizing: border-box; }
        html { color-scheme: dark; }
        body {
          margin: 0;
          min-height: 100vh;
          overflow: hidden;
          font-family: "DM Sans", ui-sans-serif, system-ui, sans-serif;
          color: #fff;
          background:
            radial-gradient(circle at 14% 18%, rgba(255,255,255,0.34), transparent 23%),
            radial-gradient(circle at 85% 9%, rgba(173,215,248,0.28), transparent 29%),
            linear-gradient(155deg, var(--sky-top) 0%, var(--sky-mid) 46%, var(--sky-bottom) 100%);
        }
        body::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.22;
          background-image:
            linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 38px 38px;
          mask-image: linear-gradient(to bottom, #000, transparent 85%);
        }
        button, textarea { font: inherit; }
        button, a { -webkit-tap-highlight-color: transparent; }
        .app-shell {
          position: relative;
          z-index: 1;
          width: min(1280px, 100%);
          min-height: 100vh;
          height: 100vh;
          margin: 0 auto;
          padding: 20px;
          display: grid;
          grid-template-columns: 270px minmax(0, 1fr);
          gap: 20px;
        }
        .glass {
          border: 1px solid var(--line);
          box-shadow: 0 24px 70px rgba(4, 21, 37, 0.3);
          backdrop-filter: blur(22px);
          -webkit-backdrop-filter: blur(22px);
        }
        .sidebar {
          min-height: 0;
          overflow: auto;
          padding: 22px 18px;
          border-radius: 34px;
          background: rgba(12, 39, 63, 0.48);
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.25) transparent;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 2px 4px 22px;
        }
        .brand-orb, .avatar {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          color: white;
          font-weight: 800;
          border: 3px solid rgba(255,255,255,0.78);
          box-shadow: 0 10px 26px rgba(5, 19, 31, 0.35);
          background:
            radial-gradient(circle at 32% 25%, #9ff2ff 0 8%, transparent 9%),
            conic-gradient(from 220deg, #071d32, #178db2, #742ea5, #0b2b45, #071d32);
        }
        .brand-orb {
          width: 48px;
          height: 48px;
          border-radius: 50%;
        }
        .brand-logo {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          object-fit: cover;
          flex: 0 0 auto;
          border: 1px solid rgba(255,255,255,0.2);
          box-shadow: 0 10px 26px rgba(5, 19, 31, 0.35);
          background: rgba(255,255,255,0.06);
        }
        .brand strong {
          display: block;
          font-size: 16px;
          letter-spacing: -0.02em;
        }
        .brand span {
          display: flex;
          align-items: center;
          gap: 5px;
          margin-top: 3px;
          color: var(--muted);
          font-size: 11px;
        }
        .online-dot, .reach-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--lime);
          box-shadow: 0 0 10px rgba(149,220,89,0.75);
        }
        .sidebar-label {
          margin: 8px 6px 10px;
          color: rgba(255,255,255,0.54);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .skill-list {
          display: grid;
          gap: 7px;
        }
        .skill-button {
          width: 100%;
          padding: 11px 12px;
          border: 1px solid transparent;
          border-radius: 16px;
          text-align: left;
          color: rgba(255,255,255,0.9);
          background: transparent;
          cursor: pointer;
          transition: 160ms ease;
        }
        .skill-button:hover {
          border-color: rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.08);
          transform: translateX(2px);
        }
        .skill-button.active {
          color: #fff;
          border-color: rgba(255,255,255,0.18);
          background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.07));
          box-shadow: inset 3px 0 0 var(--lime);
        }
        .skill-button strong {
          display: block;
          font-size: 13px;
        }
        .skill-button span {
          display: block;
          margin-top: 3px;
          color: rgba(255,255,255,0.5);
          font-size: 11px;
          line-height: 1.35;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .reach-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 2px 5px 18px;
        }
        .reach-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 8px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px;
          color: rgba(255,255,255,0.7);
          background: rgba(3,19,32,0.2);
          font-size: 10px;
        }
        .reach-dot.missing {
          background: #ffb15c;
          box-shadow: none;
        }
        .sidebar-links {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 7px;
          margin-top: 8px;
        }
        .sidebar-links a {
          padding: 9px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 13px;
          color: rgba(255,255,255,0.72);
          text-align: center;
          text-decoration: none;
          font-size: 11px;
        }
        .account-card {
          margin-top: 18px;
          padding: 12px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          background: rgba(3,19,32,0.22);
        }
        .account-role {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(37,99,235,0.22);
          color: #dbeafe;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .account-name {
          margin-top: 10px;
          font-size: 13px;
          font-weight: 700;
        }
        .account-email {
          margin-top: 3px;
          color: rgba(255,255,255,0.6);
          font-size: 11px;
          overflow-wrap: anywhere;
        }
        .quota-card {
          margin-top: 12px;
          padding: 10px 11px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          background: rgba(255,255,255,0.04);
        }
        .quota-topline {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .quota-topline strong {
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,0.9);
        }
        .quota-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 10px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 999px;
          background: rgba(15,23,42,0.32);
          color: rgba(255,255,255,0.88);
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }
        .quota-meta {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          margin-top: 9px;
          font-size: 11px;
          color: rgba(255,255,255,0.78);
        }
        .quota-track {
          margin-top: 8px;
          height: 8px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          overflow: hidden;
        }
        .quota-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 160ms ease, background 160ms ease;
        }
        .quota-footnote {
          margin-top: 7px;
          color: rgba(255,255,255,0.56);
          font-size: 10px;
          line-height: 1.35;
        }
        .account-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 7px;
          margin-top: 12px;
        }
        .account-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          margin-top: 10px;
        }
        .account-photo {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid rgba(255,255,255,0.16);
          background: rgba(255,255,255,0.08);
        }
        .account-photo-fallback {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          font-size: 14px;
          font-weight: 800;
          color: white;
          border: 1px solid rgba(255,255,255,0.16);
          background: linear-gradient(145deg, rgba(99,102,241,0.9), rgba(34,211,238,0.9));
        }
        .account-actions a {
          padding: 9px 10px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 13px;
          color: rgba(255,255,255,0.72);
          text-align: center;
          text-decoration: none;
          font-size: 11px;
        }
        .chat {
          min-width: 0;
          min-height: 0;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          overflow: hidden;
          border-radius: 38px;
          background: linear-gradient(145deg, rgba(16,53,82,0.27), rgba(7,27,45,0.38));
        }
        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 24px 12px;
        }
        .chat-title {
          display: flex;
          align-items: center;
          gap: 11px;
        }
        .mobile-menu {
          display: none;
          width: 38px;
          height: 38px;
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 50%;
          color: #fff;
          background: rgba(6,25,41,0.25);
          cursor: pointer;
        }
        .chat-title h1 {
          margin: 0;
          font-size: clamp(18px, 2.2vw, 24px);
          letter-spacing: -0.04em;
        }
        .chat-title p {
          margin: 3px 0 0;
          color: rgba(255,255,255,0.58);
          font-size: 11px;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .model-pill {
          max-width: 190px;
          overflow: hidden;
          padding: 8px 12px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 999px;
          color: rgba(255,255,255,0.74);
          background: rgba(8,30,48,0.28);
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        .meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 999px;
          color: rgba(255,255,255,0.76);
          background: rgba(8,30,48,0.22);
          font-size: 10px;
        }
        .meta-chip.alert {
          color: #ffe7b5;
          border-color: rgba(255,213,122,0.24);
          background: rgba(117,79,11,0.22);
        }
        .icon-button {
          display: grid;
          width: 36px;
          height: 36px;
          place-items: center;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 50%;
          color: #fff;
          background: rgba(8,30,48,0.28);
          cursor: pointer;
        }
        .icon-button svg {
          width: 17px;
          height: 17px;
        }
        .messages {
          min-height: 0;
          overflow: auto;
          padding: 24px clamp(18px, 5vw, 68px) 34px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.25) transparent;
        }
        .welcome {
          max-width: 580px;
          margin: 8vh auto 42px;
          text-align: center;
        }
        .welcome .brand-orb {
          width: 74px;
          height: 74px;
          margin: 0 auto 16px;
          font-size: 22px;
        }
        .welcome-logo {
          width: 74px;
          height: 74px;
          margin: 0 auto 16px;
          object-fit: cover;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.72);
          box-shadow: 0 10px 26px rgba(5, 19, 31, 0.35);
          background: rgba(255,255,255,0.08);
        }
        .welcome h2 {
          margin: 0;
          font-size: clamp(28px, 5vw, 48px);
          letter-spacing: -0.055em;
        }
        .welcome p {
          max-width: 460px;
          margin: 10px auto 0;
          color: rgba(255,255,255,0.65);
          font-size: 13px;
          line-height: 1.6;
        }
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          margin-top: 20px;
        }
        .suggestion {
          padding: 8px 12px;
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 999px;
          color: rgba(255,255,255,0.8);
          background: rgba(7,27,44,0.22);
          font-size: 11px;
          cursor: pointer;
        }
        .message-row {
          display: flex;
          align-items: flex-end;
          width: min(780px, 94%);
          margin: 0 auto 22px;
          animation: arrive 260ms ease-out;
        }
        .message-row.user { flex-direction: row-reverse; }
        .avatar {
          position: relative;
          z-index: 2;
          width: 68px;
          height: 68px;
          margin-right: -20px;
          border-radius: 50%;
          font-size: 18px;
        }
        .message-row.user .avatar {
          margin-right: 0;
          margin-left: -20px;
          color: #153149;
          background:
            radial-gradient(circle at 70% 26%, #fff 0 7%, transparent 8%),
            conic-gradient(from 40deg, #d8f0ff, #6cb7dc, #335c8b, #e1f5ff);
        }
        .bubble {
          min-width: 0;
          flex: 1;
          padding: 17px 25px 18px 34px;
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 18px 48px 48px 48px;
          color: rgba(255,255,255,0.94);
          background: var(--night);
          box-shadow:
            0 16px 35px rgba(4,17,29,0.24),
            inset 0 1px 0 rgba(255,255,255,0.13);
        }
        .message-row.user .bubble {
          padding: 17px 34px 18px 25px;
          border-color: rgba(255,255,255,0.76);
          border-radius: 48px 18px 48px 48px;
          color: var(--ink);
          background: var(--paper);
          box-shadow:
            0 16px 35px rgba(4,17,29,0.18),
            inset 0 1px 0 #fff;
        }
        .message-meta {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 6px;
          color: rgba(255,255,255,0.56);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .message-row.user .message-meta { color: rgba(16,35,51,0.54); }
        .message-content {
          overflow-wrap: anywhere;
          font-size: 13px;
          line-height: 1.55;
        }
        .message-content > :first-child {
          margin-top: 0;
        }
        .message-content > :last-child {
          margin-bottom: 0;
        }
        .message-content p,
        .message-content ul,
        .message-content ol,
        .message-content pre,
        .message-content blockquote,
        .message-content table,
        .message-content h1,
        .message-content h2,
        .message-content h3,
        .message-content h4 {
          margin: 0 0 12px;
        }
        .message-content ul,
        .message-content ol {
          padding-left: 20px;
        }
        .message-content li + li {
          margin-top: 4px;
        }
        .message-content pre {
          overflow-x: auto;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(255,255,255,0.08);
        }
        .message-row.user .message-content pre {
          background: rgba(16,35,51,0.08);
        }
        .message-content pre code {
          padding: 0;
          background: transparent;
        }
        .message-content code {
          padding: 2px 5px;
          border-radius: 5px;
          background: rgba(255,255,255,0.12);
          font-size: 0.9em;
        }
        .message-content blockquote {
          padding-left: 14px;
          border-left: 3px solid rgba(255,255,255,0.2);
          color: rgba(255,255,255,0.76);
        }
        .message-row.user .message-content blockquote {
          border-left-color: rgba(16,35,51,0.18);
          color: rgba(16,35,51,0.76);
        }
        .message-content table {
          width: 100%;
          border-collapse: collapse;
          overflow: hidden;
          border-radius: 12px;
          font-size: 12px;
          background: rgba(255,255,255,0.04);
        }
        .message-row.user .message-content table {
          background: rgba(16,35,51,0.04);
        }
        .message-content thead {
          background: rgba(255,255,255,0.08);
        }
        .message-row.user .message-content thead {
          background: rgba(16,35,51,0.08);
        }
        .message-content th,
        .message-content td {
          padding: 10px 12px;
          text-align: left;
          vertical-align: top;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .message-row.user .message-content th,
        .message-row.user .message-content td {
          border-bottom-color: rgba(16,35,51,0.08);
        }
        .message-content tr:last-child td {
          border-bottom: 0;
        }
        .message-content .katex-display {
          overflow-x: auto;
          overflow-y: hidden;
          padding: 6px 2px;
        }
        .message-row.user .message-content code { background: rgba(16,35,51,0.09); }
        .message-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .download-link {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #eff8ff;
          text-decoration: none;
          font-size: 12px;
          font-weight: 600;
          background: linear-gradient(145deg, rgba(47, 117, 172, 0.92), rgba(20, 58, 92, 0.96));
          box-shadow: 0 8px 18px rgba(8, 25, 41, 0.28);
          transition: 160ms ease;
        }
        .download-link:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
        }
        .message-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 10px;
        }
        .message-tag {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.76);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .message-row.user .message-tag {
          background: rgba(16,35,51,0.08);
          color: rgba(16,35,51,0.62);
        }
        .message-tag.warn {
          background: rgba(243,178,55,0.16);
          color: #ffd998;
        }
        .typing .bubble { flex: 0 0 auto; padding-right: 28px; }
        .typing-dots { display: flex; gap: 4px; padding: 6px 0 2px; }
        .typing-dots span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.65);
          animation: pulse 1s infinite alternate;
        }
        .typing-dots span:nth-child(2) { animation-delay: 180ms; }
        .typing-dots span:nth-child(3) { animation-delay: 360ms; }
        .composer-wrap {
          padding: 10px clamp(18px, 5vw, 68px) 22px;
        }
        .composer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: end;
          max-width: 780px;
          margin: 0 auto;
          padding: 8px 8px 8px 20px;
          border-radius: 28px 28px 28px 10px;
          background: rgba(248,250,251,0.96);
          box-shadow: 0 18px 48px rgba(4,17,29,0.27);
        }
        .composer textarea {
          width: 100%;
          min-height: 42px;
          max-height: 140px;
          resize: none;
          padding: 11px 0 8px;
          border: 0;
          outline: 0;
          color: var(--ink);
          background: transparent;
          font-size: 13px;
          line-height: 1.45;
        }
        .composer textarea::placeholder { color: #70808d; }
        .send-button {
          display: grid;
          width: 46px;
          height: 46px;
          place-items: center;
          border: 0;
          border-radius: 50%;
          color: white;
          background: linear-gradient(145deg, #224f73, #102d47);
          box-shadow: 0 8px 18px rgba(15,45,70,0.3);
          cursor: pointer;
          transition: 160ms ease;
        }
        .send-button:hover { transform: translateY(-1px) scale(1.03); }
        .send-button:disabled {
          opacity: 0.48;
          cursor: not-allowed;
        }
        .composer-note {
          max-width: 780px;
          margin: 7px auto 0;
          color: rgba(255,255,255,0.48);
          text-align: center;
          font-size: 9px;
        }
        .intro-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(2,10,18,0.68);
          opacity: 0;
          visibility: hidden;
          transition: opacity 220ms ease, visibility 220ms ease;
        }
        .intro-modal-backdrop.open {
          opacity: 1;
          visibility: visible;
        }
        .intro-modal {
          position: relative;
          width: min(460px, calc(100vw - 44px));
          padding: 24px 24px 20px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 28px;
          color: #fff;
          background: linear-gradient(180deg, rgba(16,53,82,0.96), rgba(8,26,43,0.98));
          box-shadow: 0 36px 90px rgba(0,0,0,0.42);
          transform: scale(1.12);
          opacity: 0;
          transition: transform 260ms ease, opacity 220ms ease;
        }
        .intro-modal-backdrop.open .intro-modal {
          transform: scale(1);
          opacity: 1;
        }
        .intro-close {
          position: absolute;
          top: 14px;
          right: 14px;
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 50%;
          color: rgba(255,255,255,0.82);
          background: rgba(255,255,255,0.05);
          cursor: pointer;
        }
        .intro-logo {
          display: block;
          width: 116px;
          height: 116px;
          margin: 0 auto 14px;
          border-radius: 50%;
          object-fit: cover;
          box-shadow: 0 16px 36px rgba(5,19,31,0.35);
        }
        .intro-modal h3 {
          margin: 0;
          text-align: center;
          font-size: 28px;
          letter-spacing: -0.04em;
        }
        .intro-subtitle {
          margin: 8px auto 0;
          max-width: 360px;
          color: rgba(255,255,255,0.74);
          text-align: center;
          font-size: 14px;
          line-height: 1.55;
        }
        .intro-meta {
          margin-top: 18px;
          padding: 14px 16px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          background: rgba(255,255,255,0.04);
        }
        .intro-meta strong {
          display: block;
          font-size: 12px;
          color: rgba(255,255,255,0.58);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .intro-meta span {
          display: block;
          margin-top: 7px;
          font-size: 16px;
          font-weight: 600;
        }
        .intro-cta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
          padding-top: 18px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .intro-cta-copy {
          min-width: 0;
        }
        .intro-cta-copy strong {
          display: block;
          font-size: 14px;
        }
        .intro-cta-copy span {
          display: block;
          margin-top: 4px;
          color: rgba(255,255,255,0.7);
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .intro-links {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .intro-icon-link,
        .intro-text-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255,255,255,0.12);
          text-decoration: none;
        }
        .intro-icon-link {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          color: #fff;
          background: rgba(0,136,204,0.18);
        }
        .intro-text-link {
          margin-top: 6px;
          padding: 11px 14px;
          border-radius: 999px;
          color: rgba(255,255,255,0.92);
          background: rgba(255,255,255,0.06);
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }
        .sidebar-backdrop { display: none; }
        @keyframes arrive {
          from { opacity: 0; transform: translateY(9px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          from { opacity: 0.35; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(-2px); }
        }
        @media (max-width: 820px) {
          body { overflow: hidden; }
          .app-shell {
            display: block;
            height: 100dvh;
            min-height: 100dvh;
            padding: 0;
          }
          .chat {
            height: 100%;
            border: 0;
            border-radius: 0;
          }
          .sidebar {
            position: fixed;
            z-index: 20;
            inset: 10px auto 10px 10px;
            width: min(290px, calc(100vw - 40px));
            transform: translateX(calc(-100% - 24px));
            transition: transform 220ms ease;
          }
          .sidebar.open { transform: translateX(0); }
          .sidebar-backdrop {
            position: fixed;
            z-index: 19;
            inset: 0;
            display: block;
            visibility: hidden;
            opacity: 0;
            border: 0;
            background: rgba(3,14,24,0.48);
            transition: 220ms ease;
          }
          .sidebar-backdrop.open { visibility: visible; opacity: 1; }
          .mobile-menu { display: grid; }
          .chat-header { padding: 13px 14px 8px; }
          .model-pill { max-width: 105px; }
          .messages { padding: 16px 10px 24px; }
          .welcome { margin-top: 7vh; padding: 0 18px; }
          .message-row { width: 100%; padding: 0 4px; }
          .avatar { width: 50px; height: 50px; margin-right: -15px; font-size: 14px; }
          .message-row.user .avatar { margin-left: -15px; }
          .bubble { padding: 14px 18px 15px 27px; border-radius: 14px 30px 30px 30px; }
          .message-row.user .bubble { padding: 14px 27px 15px 18px; border-radius: 30px 14px 30px 30px; }
          .message-content { font-size: 12px; }
          .composer-wrap { padding: 8px 10px max(12px, env(safe-area-inset-bottom)); }
          .intro-modal {
            width: min(420px, calc(100vw - 32px));
            padding: 22px 18px 18px;
            border-radius: 24px;
          }
          .intro-logo {
            width: 100px;
            height: 100px;
          }
          .intro-modal h3 {
            font-size: 24px;
          }
          .intro-cta {
            align-items: flex-start;
            flex-direction: column;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      </style>
    </head>
    <body>
      <button id="sidebarBackdrop" class="sidebar-backdrop" aria-label="Tutup menu"></button>
      <div class="app-shell">
        <aside id="sidebar" class="sidebar glass">
          <div class="brand">
            <img class="brand-logo" src="/assets/cybrabot-logo.png" alt="CybraFeriBot logo">
            <div>
              <strong>CybraFeriBot</strong>
              <span><i class="online-dot"></i> Online dan siap ngobrol</span>
            </div>
          </div>
          <div class="sidebar-label">Pilih keahlian</div>
          <div id="skillList" class="skill-list"></div>
          <div class="sidebar-label" style="margin-top: 22px;">Agent Reach</div>
          <div id="reachStatus" class="reach-list"></div>
          ${adminLinks}
          <div class="account-card">
            <div class="account-role">${escapeHtml(session.role)}</div>
            <div class="account-header">
              ${avatarUrl
                ? `<img class="account-photo" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
                : `<div class="account-photo-fallback">${escapeHtml(avatarInitial)}</div>`
              }
              <div style="min-width:0;">
                <div class="account-name" style="margin-top:0;">${escapeHtml(displayName)}</div>
                <div class="account-email">${escapeHtml(session.email)}</div>
                <div class="account-email">${escapeHtml([account.villageName, account.districtName, account.regencyName, account.provinceName].filter(Boolean).join(', ') || 'Wilayah belum diisi')}</div>
              </div>
            </div>
            <div class="quota-card">
              <div class="quota-topline">
                <strong>${limit} chat limit (3 hari)</strong>
                <span class="quota-pill">Free</span>
              </div>
              <div class="quota-meta">
                <span id="quotaLabel">${percentLeft}% left</span>
                <span id="quotaReset">resets ${escapeHtml(quotaResetLabel)}</span>
              </div>
              <div class="quota-track">
                <div id="quotaBar" class="quota-fill" style="width:${progressWidth}%;background:${quotaTone};"></div>
              </div>
              <div class="quota-footnote">
                Tersisa ${remaining}/${limit} chat. Reset masuk hari ke-4 dan berulang setiap 3 hari.
              </div>
            </div>
            <div class="account-actions">
              <a href="/logout">Logout</a>
            </div>
          </div>
        </aside>
        <main class="chat glass">
          <header class="chat-header">
            <div class="chat-title">
              <button id="mobileMenu" class="mobile-menu" type="button" aria-label="Buka menu">☰</button>
              <div>
                <h1 id="activeSkillTitle">Auto Skill</h1>
                <p id="activeSkillDescription">Cybra memilih kemampuan yang paling cocok.</p>
              </div>
            </div>
            <div class="header-actions">
              <span id="modelStatus" class="model-pill">Model otomatis</span>
              <button id="introButton" class="icon-button" type="button" title="Tentang CybraFeriBot" aria-label="Tentang CybraFeriBot">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button id="clearButton" class="icon-button" type="button" title="Percakapan baru" aria-label="Percakapan baru">↻</button>
            </div>
          </header>
          <section id="messages" class="messages" aria-live="polite">
            <div id="welcome" class="welcome">
              <img class="welcome-logo" src="/assets/cybrabot-logo.png" alt="CybraFeriBot logo">
              <h2>Mau bikin apa hari ini?</h2>
              <p>Tanya, riset, susun dokumen, atau bedah masalah teknis. Cybra siap membantu tanpa meminta kopi, setidaknya untuk sekarang.</p>
              <div class="suggestions">
                <button class="suggestion" type="button">Ringkas topik pelajaran</button>
                <button class="suggestion" type="button">Buat rancangan dokumen</button>
                <button class="suggestion" type="button">Cari informasi di web</button>
              </div>
            </div>
          </section>
          <footer class="composer-wrap">
            <form id="chatForm" class="composer">
              <textarea id="messageInput" rows="1" placeholder="Tulis sesuatu untuk Cybra..." autocomplete="off" aria-label="Pesan"></textarea>
              <button id="sendButton" class="send-button" type="submit" aria-label="Kirim pesan">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </form>
            <div class="composer-note">Enter untuk kirim · Shift + Enter untuk baris baru</div>
          </footer>
        </main>
      </div>
      <div id="introModalBackdrop" class="intro-modal-backdrop" aria-hidden="true">
        <div class="intro-modal" role="dialog" aria-modal="true" aria-labelledby="introModalTitle">
          <button id="introModalClose" class="intro-close" type="button" aria-label="Tutup modal">✕</button>
          <img class="intro-logo" src="/assets/cybrabot-logo.png" alt="Logo CybraFeriBot">
          <h3 id="introModalTitle">CybraFeriBot</h3>
          <p class="intro-subtitle">
            Asisten AI untuk belajar, riset, dokumen, dan percakapan teknis. Cybra dirancang agar responsif, rapi, dan langsung bisa dipakai.
          </p>
          <div class="intro-meta">
            <strong>Pengembang</strong>
            <span>Ferilee</span>
          </div>
          <div class="intro-cta">
            <div class="intro-cta-copy">
              <strong>Kontak Pengembang</strong>
              <span>Instagram</span>
              <a class="intro-text-link" href="https://instagram.com/therealferilee" target="_blank" rel="noreferrer">therealferilee</a>
            </div>
            <div class="intro-links">
              <a class="intro-icon-link" href="https://t.me/ferilee" target="_blank" rel="noreferrer" aria-label="Telegram Ferilee" title="@ferilee">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M21.2 4.36 3.9 11.02c-1.18.47-1.17 1.13-.22 1.42l4.44 1.39 1.71 5.35c.23.63.12.88.77.88.5 0 .72-.23 1-.5l2.42-2.35 5.02 3.71c.92.51 1.58.25 1.81-.85l2.95-13.89c.34-1.34-.51-1.95-1.6-1.46ZM9 13.5l10.11-6.38c.5-.31.96-.14.59.19l-8.66 7.81-.34 3.64L9 13.5Z" fill="currentColor"/>
                </svg>
              </a>
              <a class="intro-icon-link" href="https://ferilee.gurumuda.eu.org" target="_blank" rel="noreferrer" aria-label="Website Ferilee" title="ferilee.gurumuda.eu.org">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 12h18M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9Zm0 0a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
      <script>
        const skillList = document.getElementById('skillList');
        const reachStatus = document.getElementById('reachStatus');
        const messages = document.getElementById('messages');
        const form = document.getElementById('chatForm');
        const input = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const activeSkillTitle = document.getElementById('activeSkillTitle');
        const activeSkillDescription = document.getElementById('activeSkillDescription');
        const modelStatus = document.getElementById('modelStatus');
        const quotaLabel = document.getElementById('quotaLabel');
        const quotaBar = document.getElementById('quotaBar');
        const quotaReset = document.getElementById('quotaReset');
        const welcome = document.getElementById('welcome');
        const introButton = document.getElementById('introButton');
        const clearButton = document.getElementById('clearButton');
        const sidebar = document.getElementById('sidebar');
        const sidebarBackdrop = document.getElementById('sidebarBackdrop');
        const mobileMenu = document.getElementById('mobileMenu');
        const introModalBackdrop = document.getElementById('introModalBackdrop');
        const introModalClose = document.getElementById('introModalClose');
        const state = {
          skills: [],
          selectedSkillId: '',
          history: loadStoredHistory(),
        };
        const userAvatarUrl = ${JSON.stringify(avatarUrl)};
        const userAvatarInitial = ${JSON.stringify(avatarInitial)};
        const introTimerKey = ${JSON.stringify(`cybra-intro-start:${session.email}`)};
        const introAutoShownKey = ${JSON.stringify(`cybra-intro-auto-shown:${session.email}`)};
        let introTimerId = 0;
        let introAutoCloseId = 0;

        function formatResetTime(value) {
          if (!value) return '-';
          try {
            return new Intl.DateTimeFormat('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(value));
          } catch {
            return String(value);
          }
        }

        function formatResetCountdown(value) {
          if (!value) return '-';
          const diff = new Date(value).getTime() - Date.now();
          if (!Number.isFinite(diff) || diff <= 0) return 'kurang dari 1m';
          const totalMinutes = Math.max(1, Math.floor(diff / 60000));
          const days = Math.floor(totalMinutes / 1440);
          const hours = Math.floor((totalMinutes % 1440) / 60);
          const minutes = totalMinutes % 60;
          const parts = [];
          if (days > 0) parts.push(days + 'h');
          if (hours > 0 || days > 0) parts.push(hours + 'j');
          parts.push(minutes + 'm');
          return parts.join(' ');
        }

        function applyQuota(quota) {
          if (!quota || !quotaLabel || !quotaBar || !quotaReset) return;
          const remaining = Number(quota.remaining || 0);
          const limit = Number(quota.limit || 0);
          const percentLeft = Math.max(0, Math.min(100, limit ? Math.round((remaining / limit) * 100) : 0));
          quotaLabel.textContent = percentLeft + '% left';
          quotaBar.style.width = Math.max(0, Math.min(100, limit ? (remaining / limit) * 100 : 0)) + '%';
          quotaBar.style.background = remaining > 0
            ? 'linear-gradient(90deg,#22d3ee,#34d399)'
            : 'linear-gradient(90deg,#f59e0b,#ef4444)';
          const countdown = formatResetCountdown(quota.resetsAt);
          const resetTime = formatResetTime(quota.resetsAt);
          quotaReset.textContent = quota.resetsAt
            ? 'resets ' + countdown + ' • ' + resetTime
            : 'reset belum tersedia';
          sendButton.disabled = remaining <= 0;
          input.disabled = remaining <= 0;
          input.placeholder = remaining <= 0
            ? 'Kuota habis. Tunggu reset otomatis.'
            : 'Tulis sesuatu untuk Cybra...';
        }

        function loadStoredHistory() {
          try {
            const value = JSON.parse(sessionStorage.getItem('cybra-web-history') || '[]');
            return Array.isArray(value) ? value.slice(-12) : [];
          } catch {
            return [];
          }
        }

        function persistHistory() {
          sessionStorage.setItem('cybra-web-history', JSON.stringify(state.history.slice(-12)));
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderRichContent(text) {
          const source = String(text || '');
          const markdown = window.marked;
          const purifier = window.DOMPurify;

          if (!markdown || !purifier) {
            return '<p>' + escapeHtml(source) + '</p>';
          }

          const normalized = source.replaceAll(
            String.fromCharCode(13) + String.fromCharCode(10),
            String.fromCharCode(10),
          );
          markdown.setOptions({
            gfm: true,
            breaks: true,
            headerIds: false,
            mangle: false,
          });

          const parsed = markdown.parse(normalized);
          const sanitized = purifier.sanitize(parsed, {
            USE_PROFILES: { html: true },
          });

          return String(sanitized || '');
        }

        function renderMath(container) {
          if (!container || typeof window.renderMathInElement !== 'function') {
            return;
          }

          window.renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\\\[', right: '\\\\]', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\\\(', right: '\\\\)', display: false },
            ],
            throwOnError: false,
            strict: 'ignore',
          });
        }

        function renderMetaTags(meta = {}) {
          const tags = [];
          if (meta.skillTitle) tags.push('<span class="message-tag">skill: ' + escapeHtml(meta.skillTitle) + '</span>');
          if (meta.intent) tags.push('<span class="message-tag">intent: ' + escapeHtml(meta.intent) + '</span>');
          if (meta.model) tags.push('<span class="message-tag">model: ' + escapeHtml(meta.model) + '</span>');
          if (meta.fallback) tags.push('<span class="message-tag warn">fallback</span>');
          if (meta.route && !meta.skillTitle) tags.push('<span class="message-tag">' + escapeHtml(meta.route) + '</span>');
          return tags.length ? '<div class="message-tags">' + tags.join('') + '</div>' : '';
        }

        function renderMessageActions(meta = {}) {
          if (!meta.exportFile || !meta.exportFile.downloadUrl) {
            return '';
          }

          const label = meta.exportFile.format
            ? 'Unduh ' + String(meta.exportFile.format).toUpperCase()
            : 'Unduh File';

          return '<div class="message-actions">' +
            '<a class="download-link" href="' + escapeHtml(meta.exportFile.downloadUrl) + '" download="' + escapeHtml(meta.exportFile.fileName || '') + '">' +
            '<span>⬇</span><span>' + escapeHtml(label) + '</span>' +
            '</a></div>';
        }

        function addMessage(role, content, meta = {}) {
          if (welcome) welcome.hidden = true;
          document.getElementById('typingMessage')?.remove();
          const row = document.createElement('article');
          row.className = 'message-row ' + role;
          const avatar = document.createElement('div');
          if (role === 'user' && userAvatarUrl) {
            avatar.className = 'avatar';
            avatar.innerHTML = '<img src="' + escapeHtml(userAvatarUrl) + '" alt="User avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.78);box-shadow:0 10px 26px rgba(5,19,31,0.35);background:rgba(255,255,255,0.08);">';
          } else {
            avatar.className = 'avatar';
            avatar.textContent = role === 'user' ? userAvatarInitial : 'C';
          }
          const bubble = document.createElement('div');
          bubble.className = 'bubble';
          const time = new Intl.DateTimeFormat('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date());
          const label = role === 'user' ? 'Kamu' : 'Cybra';
          const detail = meta.skillTitle || meta.route || '';
          const contentHtml = renderRichContent(content);
          bubble.innerHTML =
            '<div class="message-meta"><strong>' + label + '</strong><span>' + escapeHtml(time) + '</span>' +
            (detail ? '<span>· ' + escapeHtml(detail) + '</span>' : '') +
            '</div><div class="message-content">' + contentHtml + '</div>' +
            renderMessageActions(meta) + renderMetaTags(meta);
          row.append(avatar, bubble);
          messages.appendChild(row);
          renderMath(bubble.querySelector('.message-content'));
          messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
        }

        function updateHeaderMeta(meta = {}) {
          const chips = [];
          chips.push('<span class="meta-chip">skill: ' + escapeHtml(meta.skillTitle || 'auto') + '</span>');
          if (meta.intent) chips.push('<span class="meta-chip">intent: ' + escapeHtml(meta.intent) + '</span>');
          if (meta.intentModel) chips.push('<span class="meta-chip">intent-model: ' + escapeHtml(meta.intentModel) + '</span>');
          if (meta.model) chips.push('<span class="meta-chip">model: ' + escapeHtml(meta.model) + '</span>');
          if (meta.fallback) chips.push('<span class="meta-chip alert">fallback active</span>');
          modelStatus.innerHTML = chips.join('');
        }

        function showTyping() {
          const el = document.createElement('article');
          el.id = 'typingMessage';
          el.className = 'message-row assistant typing';
          el.innerHTML =
            '<div class="avatar">C</div><div class="bubble">' +
            '<div class="message-meta"><strong>Cybra</strong><span>sedang meracik jawaban</span></div>' +
            '<div class="typing-dots"><span></span><span></span><span></span></div></div>';
          messages.appendChild(el);
          messages.scrollTop = messages.scrollHeight;
        }

        function closeSidebar() {
          sidebar.classList.remove('open');
          sidebarBackdrop.classList.remove('open');
        }

        function hideIntroModal() {
          if (!introModalBackdrop) return;
          if (introAutoCloseId) {
            window.clearTimeout(introAutoCloseId);
            introAutoCloseId = 0;
          }
          introModalBackdrop.classList.remove('open');
          introModalBackdrop.setAttribute('aria-hidden', 'true');
        }

        function showIntroModal(mode = 'manual') {
          if (!introModalBackdrop) return;
          if (introAutoCloseId) {
            window.clearTimeout(introAutoCloseId);
            introAutoCloseId = 0;
          }
          introModalBackdrop.classList.add('open');
          introModalBackdrop.setAttribute('aria-hidden', 'false');
          if (mode === 'auto') {
            sessionStorage.setItem(introAutoShownKey, '1');
            introAutoCloseId = window.setTimeout(() => {
              hideIntroModal();
            }, 10000);
          }
        }

        function scheduleIntroModal() {
          if (!introModalBackdrop) return;
          if (sessionStorage.getItem(introAutoShownKey) === '1') return;
          const stored = Number(sessionStorage.getItem(introTimerKey) || '');
          const startedAt = Number.isFinite(stored) && stored > 0 ? stored : Date.now();
          sessionStorage.setItem(introTimerKey, String(startedAt));
          const remainingMs = Math.max(0, 180000 - (Date.now() - startedAt));
          if (remainingMs === 0) {
            showIntroModal('auto');
            return;
          }
          if (introTimerId) {
            window.clearTimeout(introTimerId);
          }
          introTimerId = window.setTimeout(() => showIntroModal('auto'), remainingMs);
        }

        function selectSkill(skillId) {
          state.selectedSkillId = skillId;
          const selected = state.skills.find((skill) => skill.id === skillId);
          activeSkillTitle.textContent = selected ? selected.title : 'Auto Skill';
          activeSkillDescription.textContent = selected ? selected.description : 'Cybra memilih kemampuan yang paling cocok.';
          for (const button of skillList.querySelectorAll('button')) {
            button.classList.toggle('active', button.dataset.skillId === skillId);
          }
          closeSidebar();
        }

        async function loadSkills() {
          const response = await fetch('/api/chat/skills');
          const data = await response.json();
          state.skills = Array.isArray(data.skills) ? data.skills : [];
          skillList.innerHTML = '';

          const autoButton = document.createElement('button');
          autoButton.className = 'skill-button active';
          autoButton.dataset.skillId = '';
          autoButton.innerHTML = '<strong>✦ Auto Skill</strong><span>Biarkan Cybra memilih modul yang sesuai</span>';
          autoButton.addEventListener('click', () => selectSkill(''));
          skillList.appendChild(autoButton);

          for (const skill of state.skills) {
            const button = document.createElement('button');
            button.className = 'skill-button';
            button.dataset.skillId = skill.id;
            button.innerHTML = '<strong>' + escapeHtml(skill.title) + '</strong><span>' + escapeHtml(skill.description || '') + '</span>';
            button.addEventListener('click', () => selectSkill(skill.id));
            skillList.appendChild(button);
          }
        }

        async function loadAgentReachStatus() {
          const response = await fetch('/api/agent-reach/status');
          const data = await response.json();
          const channels = Array.isArray(data.channels) ? data.channels : [];
          reachStatus.innerHTML = channels.map((channel) => {
            const dotClass = channel.available ? 'reach-dot' : 'reach-dot missing';
            return '<span class="reach-chip" title="' + escapeHtml(channel.detail) + '">' +
              '<i class="' + dotClass + '"></i>' + escapeHtml(channel.title) + '</span>';
          }).join('');
        }

        async function loadMe() {
          const response = await fetch('/api/me');
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Gagal memuat profil.');
          applyQuota(data.quota);
        }

        async function submitMessage(rawMessage) {
          const message = String(rawMessage || '').trim();
          if (!message) return;

          input.value = '';
          input.style.height = 'auto';
          sendButton.disabled = true;
          addMessage('user', message);
          state.history.push({ role: 'user', content: message });
          persistHistory();
          showTyping();

          try {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message,
                skillId: state.selectedSkillId || undefined,
                history: state.history.slice(-12),
              }),
            });
            const data = await response.json();
            if (!response.ok) {
              if (data.quota) applyQuota(data.quota);
              throw new Error(data.error || 'Request failed');
            }
            applyQuota(data.quota);
            addMessage('assistant', data.reply || '', {
              skillTitle: data.skill?.title,
              route: data.route,
              intent: data.intent,
              intentModel: data.intentModel,
              model: data.model,
              fallback: data.fallback,
              exportFile: data.exportFile,
            });
            updateHeaderMeta({
              skillTitle: data.skill?.title,
              intent: data.intent,
              intentModel: data.intentModel,
              model: data.model,
              fallback: data.fallback,
            });
            state.history.push({ role: 'assistant', content: data.reply || '' });
            persistHistory();
          } catch (error) {
            const text = error instanceof Error ? error.message : 'Terjadi kesalahan.';
            addMessage('assistant', text, { route: 'error' });
          } finally {
            sendButton.disabled = Boolean(input.disabled);
            input.focus();
          }
        }

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          await submitMessage(input.value);
        });

        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
          }
        });

        input.addEventListener('input', () => {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        });

        clearButton.addEventListener('click', () => {
          state.history = [];
          persistHistory();
          messages.querySelectorAll('.message-row').forEach((item) => item.remove());
          if (welcome) welcome.hidden = false;
          updateHeaderMeta({});
          input.focus();
        });

        mobileMenu.addEventListener('click', () => {
          sidebar.classList.add('open');
          sidebarBackdrop.classList.add('open');
        });
        sidebarBackdrop.addEventListener('click', closeSidebar);
        introButton?.addEventListener('click', () => showIntroModal('manual'));
        introModalClose?.addEventListener('click', hideIntroModal);
        introModalBackdrop?.addEventListener('click', (event) => {
          if (event.target === introModalBackdrop) {
            hideIntroModal();
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && introModalBackdrop?.classList.contains('open')) {
            hideIntroModal();
          }
        });
        scheduleIntroModal();

        document.querySelectorAll('.suggestion').forEach((button) => {
          button.addEventListener('click', () => submitMessage(button.textContent));
        });

        Promise.all([loadSkills(), loadAgentReachStatus(), loadMe()]).then(() => {
          for (const item of state.history) {
            addMessage(item.role, item.content, { route: 'riwayat' });
          }
          updateHeaderMeta({});
          input.focus();
        }).catch(() => {
          addMessage('assistant', 'Sebagian layanan pendukung belum berhasil dimuat. Chat tetap bisa dicoba.', { route: 'peringatan' });
        });
      </script>
    </body>
    </html>
  `;
}

// Operational dashboard
app.get('/dashboard', async (c) => {
  const session = await requireAdminPageSession(c);
  if (!session) {
    return c.body(null);
  }
  const account = await requireCompleteWebAccount(c, session);
  if (!account || account instanceof Response) {
    return account || c.body(null);
  }

  const userCount = await db.select({ value: count() }).from(users);
  const msgCount = await db.select({ value: count() }).from(messages);
  const recentMessages = await db.query.messages.findMany({
    limit: 5,
    orderBy: [desc(messages.timestamp)],
    with: {
      user: true
    }
  });
  const recentTelemetry = await db.query.telemetryEvents.findMany({
    limit: 200,
    orderBy: [desc(telemetryEvents.createdAt), desc(telemetryEvents.id)],
  });
  const adminConfig = await getAdminConfig();
  const knowledgeDocs = listKnowledgeDocuments();
  const totalUsers = userCount[0]?.value ?? 0;
  const totalMessages = msgCount[0]?.value ?? 0;
  const botMessages = recentMessages.filter((message) => message.role === 'bot');
  const telemetrySummary = buildTelemetrySummaries(recentTelemetry);
  const {
    intentCounts,
    toolCounts,
    knowledgeCounts,
    averageAiLatency,
    fallbackCount,
  } = telemetrySummary;
  const formatSummaryList = (items: Record<string, number>, emptyLabel: string) => {
    const entries = Object.entries(items)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (!entries.length) {
      return `<div style="opacity: 0.6;">${emptyLabel}</div>`;
    }

    return entries
      .map(([label, value]) => `<div class="summary-row"><span>${label}</span><strong>${value}</strong></div>`)
      .join('');
  };
  const recentMessageItems = recentMessages.map((message) => {
    const role = message.role ?? 'unknown';
    const content = message.content ?? '';
    const preview = content.length > 50 ? `${content.substring(0, 50)}...` : content;
    const timeLabel = message.timestamp?.toLocaleTimeString() ?? '-';
    const roleClass = role === 'user' ? 'tag-user' : 'tag-bot';

    return `
                <div class="log-item">
                    <span>
                        <span class="tag ${roleClass}">${role.toUpperCase()}</span>
                        <span style="margin-left: 10px;">${preview || '(empty message)'}</span>
                    </span>
                    <span style="opacity: 0.4; font-size: 0.8rem;">${timeLabel}</span>
                </div>
            `;
  }).join('');

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CybraFeriBot Dashboard</title>
        <link rel="icon" type="image/png" href="/assets/favicon.png">
        <link rel="icon" type="image/x-icon" href="/favicon.ico">
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #6366f1;
                --secondary: #a855f7;
                --bg: #0f172a;
                --card-bg: rgba(30, 41, 59, 0.7);
                --text: #f8fafc;
            }
            body {
                margin: 0;
                font-family: 'Outfit', sans-serif;
                background: radial-gradient(circle at top left, #1e1b4b, #0f172a);
                color: var(--text);
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .glass {
                background: var(--card-bg);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 2rem;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            }
            .topbar {
                width: 90%;
                max-width: 1000px;
                margin-top: 1.5rem;
                display: flex;
                justify-content: flex-end;
                gap: 0.8rem;
                align-items: center;
                color: rgba(248, 250, 252, 0.7);
                font-size: 0.9rem;
            }
            .topbar a {
                color: #bfdbfe;
                text-decoration: none;
            }
            header {
                text-align: center;
                margin-top: 4rem;
                margin-bottom: 3rem;
                animation: fadeInDown 1s ease-out;
            }
            h1 {
                font-size: 3.5rem;
                margin: 0;
                background: linear-gradient(to right, var(--primary), var(--secondary));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                letter-spacing: -2px;
            }
            .stats-container {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1.5rem;
                width: 90%;
                max-width: 1000px;
                margin-bottom: 3rem;
            }
            .stat-card {
                text-align: center;
                transition: transform 0.3s ease;
            }
            .stat-card:hover {
                transform: translateY(-5px);
            }
            .stat-value {
                font-size: 2.5rem;
                font-weight: 700;
                display: block;
                color: var(--primary);
            }
            .stat-label {
                text-transform: uppercase;
                font-size: 0.8rem;
                letter-spacing: 2px;
                opacity: 0.6;
            }
            .log-section {
                width: 90%;
                max-width: 1000px;
            }
            .summary-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 1.5rem;
                width: 90%;
                max-width: 1000px;
                margin-bottom: 3rem;
            }
            .summary-row {
                display: flex;
                justify-content: space-between;
                padding: 0.45rem 0;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                font-size: 0.95rem;
            }
            .log-item {
                display: flex;
                justify-content: space-between;
                padding: 1rem;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }
            .tag {
                padding: 0.2rem 0.6rem;
                border-radius: 12px;
                font-size: 0.7rem;
                font-weight: 600;
            }
            .tag-user { background: rgba(99, 102, 241, 0.2); color: #818cf8; }
            .tag-bot { background: rgba(168, 85, 247, 0.2); color: #c084fc; }

            @keyframes fadeInDown {
                from { opacity: 0; transform: translateY(-20px); }
                to { opacity: 1; transform: translateY(0); }
            }
        </style>
    </head>
    <body>
        <div class="topbar">
            <span>${escapeHtml(session.email)} · ${escapeHtml(session.role)}</span>
            <a href="/chat">Web chat</a>
            <a href="/admin">Admin</a>
            <a href="/logout">Logout</a>
        </div>
        <header>
            <div style="font-size: 0.9rem; letter-spacing: 4px; color: var(--primary); font-weight: 600;">OPERATING SYSTEM V1.0</div>
            <h1>@CybraFeriBot</h1>
            <p style="opacity: 0.7;">Futuristic Intelligent Assistant by Feri Lee</p>
        </header>

        <div class="stats-container">
            <div class="glass stat-card">
                <span class="stat-value">${totalUsers}</span>
                <span class="stat-label">Total Users</span>
            </div>
            <div class="glass stat-card">
                <span class="stat-value">${totalMessages}</span>
                <span class="stat-label">Messages Processed</span>
            </div>
            <div class="glass stat-card">
                <span class="stat-value">Active</span>
                <span class="stat-label">System Status</span>
            </div>
        </div>

        <div class="summary-grid">
            <div class="glass">
                <h3 style="margin-top: 0;">Intent Breakdown</h3>
                ${formatSummaryList(intentCounts, 'Belum ada data intent')}
            </div>
            <div class="glass">
                <h3 style="margin-top: 0;">Tool Usage</h3>
                ${formatSummaryList(toolCounts, 'Belum ada tool dipakai')}
            </div>
            <div class="glass">
                <h3 style="margin-top: 0;">Knowledge Hits</h3>
                ${formatSummaryList(knowledgeCounts, 'Belum ada knowledge hit')}
            </div>
            <div class="glass">
                <h3 style="margin-top: 0;">AI Performance</h3>
                <div class="summary-row"><span>Avg latency</span><strong>${averageAiLatency} ms</strong></div>
                <div class="summary-row"><span>Fallback count</span><strong>${fallbackCount}</strong></div>
                <div class="summary-row"><span>Bot replies shown</span><strong>${botMessages.length}</strong></div>
            </div>
        </div>

        <div class="glass log-section" style="margin-bottom: 3rem;">
            <h3 style="margin-top: 0;">Admin Controls</h3>
            <div class="summary-row"><span>Web Chat</span><strong><a href="/" style="color:#a5b4fc;">OPEN</a></strong></div>
            <div class="summary-row"><span>Math tool</span><strong>${adminConfig.enabledTools.math ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>Caption tool</span><strong>${adminConfig.enabledTools.caption ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>Announcement tool</span><strong>${adminConfig.enabledTools.announcement ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>FAQ tool</span><strong>${adminConfig.enabledTools.faq ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>Persona override</span><strong>${adminConfig.personaOverride ? 'ACTIVE' : 'EMPTY'}</strong></div>
            <div class="summary-row"><span>Self describe templates</span><strong>${adminConfig.selfDescribe.identity && adminConfig.selfDescribe.features && adminConfig.selfDescribe.workflow && adminConfig.selfDescribe.improvement ? 'READY' : 'PARTIAL'}</strong></div>
            <p style="opacity:0.75; font-size:0.9rem; margin-top: 1rem;">
              Gunakan <a href="/admin" style="color:#a5b4fc;">panel admin</a> atau endpoint <code>/admin/config</code> dengan token admin untuk mengubah konfigurasi runtime.
            </p>
        </div>

        <div class="glass log-section" style="margin-bottom: 3rem;">
            <h3 style="margin-top: 0;">Knowledge Base</h3>
            ${knowledgeDocs.length
              ? knowledgeDocs.map((doc) => `<div class="summary-row"><span>${doc.id}</span><strong>${doc.title}</strong></div>`).join('')
              : '<div style="opacity: 0.6;">Belum ada dokumen knowledge</div>'}
        </div>

        <div class="glass log-section">
            <h3 style="margin-top: 0;">Recent Activity</h3>
            ${recentMessageItems}
        </div>
    </body>
    </html>
  `);
});

app.get('/login', async (c) => {
  const session = await getWebSession(c);
  if (session) {
    const account = await getCurrentWebAccount(session);
    if (!isWebProfileComplete(account)) {
      return c.redirect('/profile/setup');
    }
    return c.redirect(session.role === 'admin' ? '/dashboard' : '/chat');
  }

  return c.html(renderLoginPage({
    configured: isGoogleAuthConfigured(),
    nextPath: c.req.query('next') || '/chat',
    error: c.req.query('error') || undefined,
  }));
});

app.get('/auth/google', (c) => {
  if (!isGoogleAuthConfigured()) {
    return c.redirect('/login?error=' + encodeURIComponent('Google OAuth belum dikonfigurasi.'));
  }

  return c.redirect(createGoogleAuthUrl(c, c.req.query('next') || '/chat'));
});

app.get('/auth/google/callback', async (c) => {
  const state = consumeOAuthState(c, c.req.query('state'));
  if (!state) {
    return c.redirect('/login?error=' + encodeURIComponent('State login Google tidak valid atau kedaluwarsa.'));
  }

  const code = c.req.query('code');
  if (!code) {
    return c.redirect('/login?error=' + encodeURIComponent('Kode login Google tidak ditemukan.'));
  }

  try {
    const session = await createWebSessionFromGoogle(c, code);
    const account = await syncWebUserAccount(session);
    if (!isWebProfileComplete(account)) {
      return c.redirect('/profile/setup');
    }
    return c.redirect(session.role === 'admin' && state === '/chat' ? '/dashboard' : state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login Google gagal.';
    return c.redirect('/login?error=' + encodeURIComponent(message));
  }
});

app.get('/logout', (c) => {
  clearWebSession(c);
  return c.redirect('/login');
});

app.get('/profile/setup', async (c) => {
  const session = await requireWebSession(c);
  if (!session) {
    return c.body(null);
  }

  const account = await getCurrentWebAccount(session) || await syncWebUserAccount(session);
  if (isWebProfileComplete(account)) {
    return c.redirect(session.role === 'admin' ? '/dashboard' : '/chat');
  }

  return c.html(renderProfileSetupPage(session, {
    error: c.req.query('error') || undefined,
  }));
});

app.get('/favicon.ico', async (c) => {
  const filePath = getAssetPath('favicon.ico');
  if (!filePath) {
    return c.text('Not Found', 404);
  }

  return c.body(await Bun.file(filePath).bytes(), 200, {
    'content-type': getAssetContentType('favicon.ico'),
    'cache-control': 'public, max-age=604800, immutable',
  });
});

app.get('/assets/:fileName', async (c) => {
  const fileName = c.req.param('fileName');
  const filePath = getAssetPath(fileName);
  if (!filePath) {
    return c.text('Not Found', 404);
  }

  return c.body(await Bun.file(filePath).bytes(), 200, {
    'content-type': getAssetContentType(fileName),
    'cache-control': 'public, max-age=604800, immutable',
  });
});

app.get('/admin', async (c) => {
  const session = await requireAdminPageSession(c);
  if (!session) {
    return c.body(null);
  }
  const account = await requireCompleteWebAccount(c, session);
  if (!account || account instanceof Response) {
    return account || c.body(null);
  }
  return c.html(renderAdminPage(session));
});

app.get('/', async (c) => {
  const session = await getWebSession(c);
  if (!session) {
    return c.redirect('/login');
  }
  const account = await getCurrentWebAccount(session);
  if (!isWebProfileComplete(account)) {
    return c.redirect('/profile/setup');
  }
  return c.redirect(session.role === 'admin' ? '/dashboard' : '/chat');
});

app.get('/chat', async (c) => {
  const session = await requireWebSession(c);
  if (!session) {
    return c.body(null);
  }
  const account = await requireCompleteWebAccount(c, session);
  if (!account || account instanceof Response) {
    return account || c.body(null);
  }
  return c.html(renderWebChatPage(session, account, toWebQuotaStatus(account)));
});

app.get('/api/regions/provinces', async (c) => {
  const response = await fetch('https://emsifa.github.io/api-wilayah-indonesia/api/provinces.json');
  if (!response.ok) {
    return c.json({ error: 'Failed to fetch provinces' }, 502);
  }
  return c.json(await response.json());
});

app.get('/api/regions/regencies/:provinceId', async (c) => {
  const response = await fetch(`https://emsifa.github.io/api-wilayah-indonesia/api/regencies/${encodeURIComponent(c.req.param('provinceId'))}.json`);
  if (!response.ok) {
    return c.json({ error: 'Failed to fetch regencies' }, 502);
  }
  return c.json(await response.json());
});

app.get('/api/regions/districts/:regencyId', async (c) => {
  const response = await fetch(`https://emsifa.github.io/api-wilayah-indonesia/api/districts/${encodeURIComponent(c.req.param('regencyId'))}.json`);
  if (!response.ok) {
    return c.json({ error: 'Failed to fetch districts' }, 502);
  }
  return c.json(await response.json());
});

app.get('/api/regions/villages/:districtId', async (c) => {
  const response = await fetch(`https://emsifa.github.io/api-wilayah-indonesia/api/villages/${encodeURIComponent(c.req.param('districtId'))}.json`);
  if (!response.ok) {
    return c.json({ error: 'Failed to fetch villages' }, 502);
  }
  return c.json(await response.json());
});

app.post('/api/profile/setup', async (c) => {
  const session = await requireApiSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Payload tidak valid.' }, 400);
  }

  const requiredFields = [
    'fullName',
    'provinceId',
    'provinceName',
    'regencyId',
    'regencyName',
    'districtId',
    'districtName',
    'villageId',
    'villageName',
  ] as const;

  for (const field of requiredFields) {
    if (typeof body[field] !== 'string' || !String(body[field]).trim()) {
      return c.json({ error: `${field} wajib diisi.` }, 400);
    }
  }

  const saved = await saveWebUserProfile({
    email: session.email,
    fullName: String(body.fullName),
    provinceId: String(body.provinceId),
    provinceName: String(body.provinceName),
    regencyId: String(body.regencyId),
    regencyName: String(body.regencyName),
    districtId: String(body.districtId),
    districtName: String(body.districtName),
    villageId: String(body.villageId),
    villageName: String(body.villageName),
  });

  return c.json({
    ok: true,
    profile: saved,
    quota: toWebQuotaStatus(saved || null),
  });
});

app.get('/api/me', async (c) => {
  const session = await requireApiSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const account = await getCurrentWebAccount(session);
  if (!account) {
    return c.json({ error: 'Web account not found' }, 404);
  }

  return c.json({
    session,
    profile: {
      fullName: account.fullName,
      profileCompleted: Boolean(account.profileCompleted),
      region: [account.villageName, account.districtName, account.regencyName, account.provinceName].filter(Boolean).join(', '),
    },
    quota: await getWebQuotaStatus(session.email),
  });
});

app.get('/api/chat/skills', async (c) => {
  const session = await requireApiSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const account = await requireCompleteWebAccount(c, session, true);
  if (!account || account instanceof Response) {
    return account || c.json({ error: 'Unauthorized' }, 401);
  }
  return c.json({ skills: getWebChatSkills() });
});

app.get('/api/agent-reach/status', async (c) => {
  const session = await requireApiSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const account = await requireCompleteWebAccount(c, session, true);
  if (!account || account instanceof Response) {
    return account || c.json({ error: 'Unauthorized' }, 401);
  }
  return c.json({ channels: getAgentReachStatus() });
});

app.get('/api/exports/:fileName', async (c) => {
  const session = await requireApiSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const account = await requireCompleteWebAccount(c, session, true);
  if (!account || account instanceof Response) {
    return account || c.json({ error: 'Unauthorized' }, 401);
  }
  const fileName = c.req.param('fileName');
  const filePath = getManagedExportFile(fileName);
  if (!filePath) {
    return c.text('Not Found', 404);
  }

  return c.body(await Bun.file(filePath).bytes(), 200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': `attachment; filename="${fileName}"`,
  });
});

app.post('/api/chat', async (c) => {
  const session = await requireApiSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const account = await requireCompleteWebAccount(c, session, true);
  if (!account || account instanceof Response) {
    return account || c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    message?: unknown;
    skillId?: unknown;
    history?: unknown;
  }>().catch(() => null);

  if (!body || typeof body.message !== 'string') {
    return c.json({ error: 'message is required' }, 400);
  }

  const history = Array.isArray(body.history)
    ? body.history.filter((item): item is { role: 'user' | 'assistant'; content: string } => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const value = item as Record<string, unknown>;
        return (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string';
      })
    : [];

  const quotaAttempt = await consumeWebChatQuota(session.email);
  if (!quotaAttempt.ok) {
    const statusCode = quotaAttempt.reason === 'suspended' ? 403 : 429;
    const message = quotaAttempt.reason === 'suspended'
      ? 'Akun web ini sedang dinonaktifkan admin.'
      : `Kuota habis. Anda mendapat ${WEB_CHAT_QUOTA_LIMIT} obrolan gratis setiap ${WEB_CHAT_QUOTA_WINDOW_DAYS} hari.`;
    return c.json({ error: message, quota: quotaAttempt.quota }, statusCode);
  }

  const result = await handleWebChat({
    message: body.message,
    skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
    history,
  });

  await appendWebChatLog({
    email: session.email,
    role: 'user',
    content: body.message,
    route: 'web_user_input',
    skillId: typeof body.skillId === 'string' ? body.skillId : null,
  });
  await appendWebChatLog({
    email: session.email,
    role: 'assistant',
    content: result.reply || '',
    route: result.route,
    skillId: result.skill?.id || null,
    intent: result.intent,
    model: result.model,
  });

  return c.json({
    ...result,
    quota: quotaAttempt.quota,
  });
});

app.post('/api/integration/chat', async (c) => {
  const body = await c.req.json<{
    message?: string;
    history?: any[];
  }>().catch(() => null);

  if (!body || !body.message) {
    return c.json({ error: 'Invalid input' }, 400);
  }

  const result = await handleWebChat({
    message: body.message,
    history: body.history,
  });

  return c.json(result);
});

app.get('/admin/insights', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const recentTelemetry = await db.query.telemetryEvents.findMany({
    limit: 500,
    orderBy: [desc(telemetryEvents.createdAt), desc(telemetryEvents.id)],
  });

  const summaries = buildTelemetrySummaries(recentTelemetry);
  const topUsers = await getTopUsers(10);

  return c.json({
    topUsers,
    routeBreakdown: summaries.routeBreakdown,
    recentFailures: summaries.recentFailures,
  });
});

app.get('/admin/quota', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const adminConfig = await getAdminConfig();
  const status = await getProviderQuotaStatus();
  const activeModel = adminConfig.models.chat;
  const lower = activeModel.trim().toLowerCase();
  const provider =
    lower.startsWith('tokenrouter:') || lower.startsWith('openai:') || lower.startsWith('openai-compatible:')
      ? 'OpenAI-compatible'
      : 'Gemini';

  return c.json({
    provider,
    activeModel,
    providerStatus: status,
  });
});

app.get('/admin/config', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const config = await getAdminConfig();
  return c.json(config);
});

app.post('/admin/config', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const updated = await saveAdminConfig({
    personaOverride: typeof body.personaOverride === 'string' ? body.personaOverride : undefined,
    responseTemplates: typeof body.responseTemplates === 'object' && body.responseTemplates
      ? {
          markdownProcessing: typeof (body.responseTemplates as Record<string, unknown>).markdownProcessing === 'string'
            ? (body.responseTemplates as Record<string, unknown>).markdownProcessing as string
            : undefined,
          documentProcessing: typeof (body.responseTemplates as Record<string, unknown>).documentProcessing === 'string'
            ? (body.responseTemplates as Record<string, unknown>).documentProcessing as string
            : undefined,
          aiError: typeof (body.responseTemplates as Record<string, unknown>).aiError === 'string'
            ? (body.responseTemplates as Record<string, unknown>).aiError as string
            : undefined,
          documentError: typeof (body.responseTemplates as Record<string, unknown>).documentError === 'string'
            ? (body.responseTemplates as Record<string, unknown>).documentError as string
            : undefined,
          exportError: typeof (body.responseTemplates as Record<string, unknown>).exportError === 'string'
            ? (body.responseTemplates as Record<string, unknown>).exportError as string
            : undefined,
        }
      : undefined,
    selfDescribe: typeof body.selfDescribe === 'object' && body.selfDescribe
      ? {
          identity: typeof (body.selfDescribe as Record<string, unknown>).identity === 'string'
            ? (body.selfDescribe as Record<string, unknown>).identity as string
            : undefined,
          features: typeof (body.selfDescribe as Record<string, unknown>).features === 'string'
            ? (body.selfDescribe as Record<string, unknown>).features as string
            : undefined,
          workflow: typeof (body.selfDescribe as Record<string, unknown>).workflow === 'string'
            ? (body.selfDescribe as Record<string, unknown>).workflow as string
            : undefined,
          improvement: typeof (body.selfDescribe as Record<string, unknown>).improvement === 'string'
            ? (body.selfDescribe as Record<string, unknown>).improvement as string
            : undefined,
        }
      : undefined,
    enabledTools: typeof body.enabledTools === 'object' && body.enabledTools
      ? {
          math: Boolean((body.enabledTools as Record<string, unknown>).math),
          caption: Boolean((body.enabledTools as Record<string, unknown>).caption),
          announcement: Boolean((body.enabledTools as Record<string, unknown>).announcement),
          faq: Boolean((body.enabledTools as Record<string, unknown>).faq),
        }
      : undefined,
  });

  return c.json({ ok: true, config: updated });
});

app.get('/admin/knowledge', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  return c.json({ items: listKnowledgeDocuments() });
});

app.get('/admin/users', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  return c.json({ items: await listManagedWebUsers() });
});

app.get('/admin/users/:email/logs', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const result = await getManagedWebUserLogs(c.req.param('email'));
  if (!result) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(result);
});

app.patch('/admin/users/:email', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const updated = await updateManagedWebUser(c.req.param('email'), {
    suspended: body && typeof body.suspended === 'boolean' ? body.suspended : undefined,
    resetQuota: Boolean(body && body.resetQuota),
  });

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ ok: true, item: updated, quota: toWebQuotaStatus(updated) });
});

app.post('/admin/knowledge', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const body = await c.req.json<{ id?: string; title?: string; content?: string }>().catch(() => null);
  if (!body?.title || !body?.content) {
    return c.json({ error: 'title and content are required' }, 400);
  }

  const item = saveKnowledgeDocument({
    id: body.id,
    title: body.title,
    content: body.content,
  });

  return c.json({ ok: true, item });
});

app.delete('/admin/knowledge/:id', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  deleteKnowledgeDocument(c.req.param('id'));
  return c.json({ ok: true });
});

app.post('/admin/preferences/reset', async (c) => {
  const access = await requireAdminApiAccess(c);
  if (!access.ok) {
    return c.json({ error: access.status === 403 ? 'Forbidden' : 'Unauthorized' }, access.status);
  }

  const body = await c.req.json<{ userId?: number }>().catch(() => null);
  if (!body?.userId) {
    return c.json({ error: 'userId is required' }, 400);
  }

  await resetUserPreferences(body.userId);
  return c.json({ ok: true, userId: body.userId });
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Telegram Webhook
app.post('/api/webhook', handleUpdate);

export default app;
