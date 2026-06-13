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
  const parsedTelemetry = recentTelemetry.map((item) => {
    let payload: Record<string, unknown> = {};

    try {
      payload = item.payload ? JSON.parse(item.payload) : {};
    } catch {
      payload = {};
    }

    return { item, payload };
  });
  const intentCounts = parsedTelemetry
    .filter(({ item }) => item.event === 'message.intent_classified')
    .reduce<Record<string, number>>((acc, entry) => {
      const payload = entry.payload as { intent?: string };
      const intent = payload.intent || 'unknown';
      acc[intent] = (acc[intent] || 0) + 1;
      return acc;
    }, {});
  const toolCounts = parsedTelemetry
    .filter(({ item }) => item.event === 'message.tool_used')
    .reduce<Record<string, number>>((acc, entry) => {
      const payload = entry.payload as { toolName?: string };
      const toolName = payload.toolName || 'unknown';
      acc[toolName] = (acc[toolName] || 0) + 1;
      return acc;
    }, {});
  const aiEvents = parsedTelemetry
    .map((entry) => ({ item: entry.item, payload: entry.payload as { latencyMs?: number; knowledgeMatches?: string[]; fallback?: boolean } }))
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
              Gunakan endpoint <code>/admin/config</code> dengan token admin untuk mengubah konfigurasi runtime.
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
