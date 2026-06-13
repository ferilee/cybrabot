import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { handleUpdate } from '../bot';
import { getAdminConfig, isValidAdminToken, saveAdminConfig } from '../lib/admin-config';
import { deleteKnowledgeDocument, listKnowledgeDocuments, saveKnowledgeDocument } from '../lib/knowledge';
import { resetUserPreferences } from '../lib/preferences';
import { db } from '../db';
import { users, messages, telemetryEvents } from '../db/schema';
import { count, desc } from 'drizzle-orm';

const app = new Hono();

app.use('*', logger());

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

function renderAdminPage() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CybraFeriBot Admin</title>
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
              <p class="hint">Panel ini memakai endpoint admin yang sudah ada. Token tidak disimpan di server; hanya dipakai di browser untuk memanggil API.</p>
            </div>
            <div><a href="/">Kembali ke dashboard</a></div>
          </div>
          <label>
            Admin token
            <input id="adminToken" type="password" placeholder="Masukkan ADMIN_TOKEN" />
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
        const knowledgeStatus = document.getElementById('knowledgeStatus');
        const preferencesStatus = document.getElementById('preferencesStatus');
        const knowledgeList = document.getElementById('knowledgeList');
        const routeList = document.getElementById('routeList');
        const topUsersList = document.getElementById('topUsersList');
        const failureList = document.getElementById('failureList');

        tokenInput.value = params.get('token') || '';

        function setStatus(target, message, type = '') {
          target.className = 'status' + (type ? ' ' + type : '');
          target.textContent = message;
        }

        function requireToken() {
          const token = tokenInput.value.trim();
          if (!token) {
            throw new Error('ADMIN_TOKEN wajib diisi.');
          }
          return token;
        }

        function adminUrl(path) {
          const token = encodeURIComponent(requireToken());
          return path + (path.includes('?') ? '&' : '?') + 'token=' + token;
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
            await Promise.all([loadConfig(), loadKnowledge(), loadInsights()]);
            setStatus(globalStatus, 'State runtime berhasil dimuat.', 'ok');
          } catch (error) {
            setStatus(globalStatus, error.message, 'error');
          }
        });

        document.getElementById('saveConfigButton').addEventListener('click', async () => {
          try {
            setStatus(configStatus, 'Menyimpan config...');
            const payload = {
              enabledTools: {
                math: document.getElementById('toolMath').checked,
                caption: document.getElementById('toolCaption').checked,
                announcement: document.getElementById('toolAnnouncement').checked,
                faq: document.getElementById('toolFaq').checked,
              },
              personaOverride: document.getElementById('personaOverride').value.trim(),
            };
            await api('/admin/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            setStatus(configStatus, 'Config runtime berhasil disimpan.', 'ok');
          } catch (error) {
            setStatus(configStatus, error.message, 'error');
          }
        });

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
      </script>
    </body>
    </html>
  `;
}

// Root Dashboard (Premium Aesthetics)
app.get('/', async (c) => {
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
            <div class="summary-row"><span>Math tool</span><strong>${adminConfig.enabledTools.math ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>Caption tool</span><strong>${adminConfig.enabledTools.caption ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>Announcement tool</span><strong>${adminConfig.enabledTools.announcement ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>FAQ tool</span><strong>${adminConfig.enabledTools.faq ? 'ON' : 'OFF'}</strong></div>
            <div class="summary-row"><span>Persona override</span><strong>${adminConfig.personaOverride ? 'ACTIVE' : 'EMPTY'}</strong></div>
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

app.get('/admin', (c) => c.html(renderAdminPage()));

app.get('/admin/insights', async (c) => {
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
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

app.get('/admin/config', async (c) => {
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const config = await getAdminConfig();
  return c.json(config);
});

app.post('/admin/config', async (c) => {
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const updated = await saveAdminConfig({
    personaOverride: typeof body.personaOverride === 'string' ? body.personaOverride : undefined,
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
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ items: listKnowledgeDocuments() });
});

app.post('/admin/knowledge', async (c) => {
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
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
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  deleteKnowledgeDocument(c.req.param('id'));
  return c.json({ ok: true });
});

app.post('/admin/preferences/reset', async (c) => {
  const token = c.req.query('token') || c.req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    return c.json({ error: 'Unauthorized' }, 401);
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
