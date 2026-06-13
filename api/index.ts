import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { handleUpdate } from '../bot';
import { db } from '../db';
import { users, messages } from '../db/schema';
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
                <span class="stat-value">${userCount[0].value}</span>
                <span class="stat-label">Total Users</span>
            </div>
            <div class="glass stat-card">
                <span class="stat-value">${msgCount[0].value}</span>
                <span class="stat-label">Messages Processed</span>
            </div>
            <div class="glass stat-card">
                <span class="stat-value">Active</span>
                <span class="stat-label">System Status</span>
            </div>
        </div>

        <div class="glass log-section">
            <h3 style="margin-top: 0;">Recent Activity</h3>
            ${recentMessages.map(m => `
                <div class="log-item">
                    <span>
                        <span class="tag ${m.role === 'user' ? 'tag-user' : 'tag-bot'}">${m.role.toUpperCase()}</span>
                        <span style="margin-left: 10px;">${m.content.substring(0, 50)}${m.content.length > 50 ? '...' : ''}</span>
                    </span>
                    <span style="opacity: 0.4; font-size: 0.8rem;">${m.timestamp?.toLocaleTimeString()}</span>
                </div>
            `).join('')}
        </div>
    </body>
    </html>
  `);
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Telegram Webhook
app.post('/api/webhook', handleUpdate);

export default app;
