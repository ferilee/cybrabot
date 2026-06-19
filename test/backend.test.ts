import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import app from '../api';
import { getAdminConfig, isOpenAICompatibleConfigured, isValidAdminToken, saveAdminConfig } from '../lib/admin-config';
import { chooseAgentReachChannel, getAgentReachStatus } from '../lib/agent-reach';
import { analyzeText } from '../lib/nlp';
import { getProviderQuotaStatus } from '../lib/provider-status';
import {
  detectPreferenceUpdate,
  formatPreferenceConfirmation,
  formatPreferenceInstruction,
  getUserPreferences,
  resetUserPreferences,
  saveUserPreferences,
} from '../lib/preferences';
import { runLocalTool } from '../lib/tools';
import { escapeHtml, formatTelegramRichCard, formatTelegramRichCardWithBody, formatTelegramRichText } from '../lib/telegram-rich';
import { getWebSkill, loadWebSkills, selectWebSkill } from '../lib/web-skills';
import { clearActiveDocumentSession, getActiveDocumentSession, saveActiveDocumentSession } from '../lib/document-session';
import { isDocxMimeType, isTextDocumentMimeType, isXlsxMimeType, extractTextFromDocument } from '../lib/document-source';
import {
  cleanupExportFile,
  createDocxDocument,
  createPdfDocument,
  detectDocumentExportRequest,
  materializeExportFile,
} from '../lib/document-export';
import {
  detectHumanisMarkdownRequest,
  materializeHumanisMarkdown,
  resolveManagedExportPath,
} from '../lib/humanis-export';
import {
  deleteKnowledgeDocument,
  formatKnowledgeContext,
  getKnowledgeContext,
  listKnowledgeDocuments,
  reloadKnowledgeDocuments,
  retrieveKnowledge,
  saveKnowledgeDocument,
} from '../lib/knowledge';
import { getWebChatSkills, handleWebChat } from '../lib/web-chat';
import { logEvent } from '../lib/observability';
import { importFresh, resetDatabase, resetKnowledgeDirectory, testArtifactsDir } from './helpers/runtime';

const adminHeaders = { 'x-admin-token': 'test-admin-token', 'content-type': 'application/json' };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetDatabase();
  resetKnowledgeDirectory();
  reloadKnowledgeDocuments();
  mock.restore();
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_COMPAT_API_KEY;
  delete process.env.TOKENROUTER_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_COMPAT_BASE_URL;
  delete process.env.TOKENROUTER_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('backend utilities', () => {
  test('analyzeText detects numbers and questions', () => {
    const result = analyzeText('Berapa hasil 2 + 2?');
    expect(result.hasNumbers).toBe(true);
    expect(result.isQuestion).toBe(true);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(Array.isArray(result.topics)).toBe(true);
    expect(Array.isArray(result.verbs)).toBe(true);
  });

  test('preferences parser and formatter work end-to-end', async () => {
    const parsed = detectPreferenceUpdate('Panggil aku Feri dan jawaban detail dengan bahasa santai');
    expect(parsed).toEqual({
      preferredName: 'Feri',
      answerLength: 'detail',
      tone: 'santai',
    });

    const saved = await saveUserPreferences(1, parsed || {});
    expect(saved.preferredName).toBe('Feri');
    expect(formatPreferenceInstruction(saved)).toContain('Panggil pengguna dengan nama "Feri".');
    expect(formatPreferenceConfirmation(saved)).toContain('Feri');

    const loaded = await getUserPreferences(1);
    expect(loaded).toEqual(saved);

    await resetUserPreferences(1);
    expect(await getUserPreferences(1)).toEqual({});
  });

  test('telegram rich helpers format HTML-safe output', () => {
    expect(escapeHtml('<tag>&')).toBe('&lt;tag&gt;&amp;');

    const card = formatTelegramRichCard({
      title: 'Tes',
      subtitle: 'Sub',
      badge: 'OK',
      fields: [{ label: 'Model', value: 'gemini' }],
    });
    expect(card).toContain('<b>Tes</b>');
    expect(card).toContain('<code>OK</code>');

    const rich = formatTelegramRichCardWithBody({
      title: 'Judul',
      fields: [{ label: 'A', value: 'B' }],
      bodyHtml: formatTelegramRichText('# Halo\n- satu\n```ts\nconst a = 1;\n```'),
    });
    expect(rich).toContain('<b>Halo</b>');
    expect(rich).toContain('<ul><li>satu</li></ul>');
    expect(rich).toContain('<pre><code>');
  });

  test('admin config loads defaults, saves merge, and validates token', async () => {
    const initial = await getAdminConfig();
    expect(initial.enabledTools.math).toBe(true);

    const updated = await saveAdminConfig({
      personaOverride: 'pakai bahasa santai',
      enabledTools: { math: false },
      models: { chat: 'tokenrouter:MiniMax-M3' },
    });
    expect(updated.enabledTools.math).toBe(false);
    expect(updated.models.chat).toBe('tokenrouter:MiniMax-M3');
    expect(updated.personaOverride).toBe('pakai bahasa santai');

    expect(isValidAdminToken('test-admin-token')).toBe(true);
    expect(isValidAdminToken('salah')).toBe(false);

    process.env.TOKENROUTER_API_KEY = 'sk-test';
    expect(isOpenAICompatibleConfigured()).toBe(true);
  });

  test('knowledge CRUD and retrieval work', () => {
    const item = saveKnowledgeDocument({
      id: 'trigonometri',
      title: 'Trigonometri Dasar',
      content: 'Sin, cos, dan tan adalah perbandingan sisi pada segitiga siku-siku.',
    });
    expect(item.id).toBe('trigonometri');
    expect(listKnowledgeDocuments()).toHaveLength(1);
    expect(retrieveKnowledge('jelaskan sin cos tan', 1)[0]?.id).toBe('trigonometri');
    expect(formatKnowledgeContext('sin cos')).toContain('Trigonometri Dasar');
    expect(getKnowledgeContext('sin cos').matches).toContain('trigonometri');

    deleteKnowledgeDocument('trigonometri');
    expect(listKnowledgeDocuments()).toHaveLength(0);
  });

  test('document export parser and generators create files', async () => {
    const pdfRequest = detectDocumentExportRequest('Buatkan PDF proposal class meeting');
    expect(pdfRequest?.format).toBe('pdf');
    expect(pdfRequest?.title).toContain('proposal class meeting');

    const docxRequest = detectDocumentExportRequest('Tolong bikin word laporan kegiatan');
    expect(docxRequest?.format).toBe('docx');

    const content = '# Laporan\n\n## Isi\n- Poin satu\nParagraf penutup';
    const pdfBuffer = await createPdfDocument('Laporan', content);
    expect(Buffer.from(pdfBuffer).subarray(0, 4).toString()).toBe('%PDF');

    const docxBuffer = await createDocxDocument('Laporan', content);
    expect(Buffer.from(docxBuffer).subarray(0, 2).toString()).toBe('PK');

    const materialized = await materializeExportFile('Laporan', content, 'pdf');
    expect(existsSync(materialized.outputPath)).toBe(true);
    cleanupExportFile(materialized.outputPath);
    expect(existsSync(materialized.outputPath)).toBe(false);
  });

  test('humanis markdown export detection and file materialization work', async () => {
    const request = detectHumanisMarkdownRequest('Buatkan file markdown penjelasan humanis tentang MCP dengan bahasa awam');
    expect(request?.format).toBe('md');
    expect(request?.title.toLowerCase()).toContain('penjelasan humanis');

    const exported = await materializeHumanisMarkdown('Penjelasan Humanis MCP', '# MCP\n\nIni isi penjelasannya.');
    expect(resolveManagedExportPath(exported.fileName)).toBe(exported.outputPath);
    expect(existsSync(exported.outputPath)).toBe(true);
  });

  test('document source extracts text from docx and xlsx', async () => {
    const docxPath = join(testArtifactsDir, 'sample.docx');
    const xlsxPath = join(testArtifactsDir, 'sample.xlsx');
    await Bun.write(docxPath, await createDocxDocument('Judul', '# Isi\n\nParagraf uji dokumen.'));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Nama', 'Nilai'],
      ['Feri', 95],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Nilai');
    XLSX.writeFile(workbook, xlsxPath);

    expect(isDocxMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(isXlsxMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(isTextDocumentMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);

    const docxText = await extractTextFromDocument(docxPath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const xlsxText = await extractTextFromDocument(xlsxPath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    expect(docxText).toContain('Paragraf uji dokumen');
    expect(xlsxText).toContain('Nilai');
    expect(xlsxText).toContain('Feri | 95');
  });

  test('document session stores and clears active document', async () => {
    const filePath = join(testArtifactsDir, 'active.txt');
    await Bun.write(filePath, 'isi');

    await saveActiveDocumentSession({
      userId: 77,
      title: 'Aktif',
      mimeType: 'application/pdf',
      sourceKind: 'text',
      localFilePath: filePath,
      summary: 'Ringkasan',
    });

    const session = await getActiveDocumentSession(77);
    expect(session?.title).toBe('Aktif');
    expect(session?.summary).toBe('Ringkasan');

    await clearActiveDocumentSession(77);
    expect(await getActiveDocumentSession(77)).toBeNull();
    expect(existsSync(filePath)).toBe(false);
  });

  test('local tools respond for math, caption, announcement, faq, and self describe', async () => {
    const config = await getAdminConfig();
    saveKnowledgeDocument({
      id: 'mgmp',
      title: 'MGMP',
      content: 'MGMP adalah forum guru mata pelajaran.',
    });

    expect(runLocalTool('Tolong hitung 12 / 3', config).toolName).toBe('math');
    expect(runLocalTool('Bikin caption sekolah untuk lomba coding', config).toolName).toBe('caption');
    expect(runLocalTool('Buatkan pengumuman rapat wali murid', config).toolName).toBe('announcement');
    expect(runLocalTool('Apa itu MGMP?', config).toolName).toBe('faq');
    expect(runLocalTool('Bagaimana cybraferibot bisa meningkatkan kemampuan bot?', config).toolName).toBe('self_describe');

    const disabled = await saveAdminConfig({ enabledTools: { math: false } });
    expect(runLocalTool('Hitung 3+3', disabled).handled).toBe(false);
  });

  test('provider status handles missing key and success payloads', async () => {
    expect((await getProviderQuotaStatus()).ok).toBe(false);

    process.env.TOKENROUTER_API_KEY = 'sk-test';
    process.env.TOKENROUTER_BASE_URL = 'https://api.tokenrouter.com/v1';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'ok', remaining: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const status = await getProviderQuotaStatus();
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.summary).toContain('remaining: 42');
    }
  });

  test('agent reach channel selection and status reporting are deterministic', () => {
    expect(chooseAgentReachChannel('https://github.com/ferilee/cybrabot')).toBe('github');
    expect(chooseAgentReachChannel('https://youtu.be/abc123')).toBe('youtube');
    expect(chooseAgentReachChannel('baca halaman https://example.com')).toBe('web');
    expect(chooseAgentReachChannel('carikan referensi trigonometri kelas 10')).toBe('search');

    const channels = getAgentReachStatus();
    expect(channels.map((item) => item.id)).toContain('search');
    expect(channels.map((item) => item.id)).toContain('github');
  });

  test('web skill registry and selector work', () => {
    const skills = loadWebSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(getWebSkill('grill-me')?.title).toBe('Grill Me');
    expect(getWebSkill('penjelasan-humanis')?.title).toBe('Penjelasan Humanis');
    expect(selectWebSkill('tolong bantu deploy docker', undefined, 'technical')?.id).toBe('technical-helper');
    expect(selectWebSkill('uji saya untuk interview backend')?.id).toBe('grill-me');
    expect(selectWebSkill('jelaskan MCP dengan bahasa awam dan kasih analogi')?.id).toBe('penjelasan-humanis');
    expect(getWebChatSkills().map((item) => item.id)).toContain('general-chat');
  });
});

describe('skill and web chat routing', () => {
  test('runSkillChat uses mocked AI and agent reach metadata', async () => {
    const aiUrl = join(process.cwd(), 'lib/ai.ts');
    const agentUrl = join(process.cwd(), 'lib/agent-reach.ts');

    mock.module(aiUrl, () => ({
      getIntent: async () => ({ intent: 'casual', model: 'intent-mock', latencyMs: 1, fallback: false }),
      generateSkillResponse: async () => ({
        text: 'hasil akhir',
        model: 'chat-mock',
        latencyMs: 12,
        knowledgeMatches: ['doc-1'],
        historyCount: 0,
        fallback: false,
      }),
    }));

    mock.module(agentUrl, () => ({
      runAgentReach: async () => ({
        channel: 'search',
        backend: 'mock-search',
        query: 'q',
        content: 'konten pencarian',
        sources: ['https://example.com'],
      }),
    }));

    const { runSkillChat } = await importFresh<typeof import('../lib/skill-chat')>('lib/skill-chat.ts');
    const result = await runSkillChat({
      message: 'carikan referensi trigonometri',
      adminConfig: await getAdminConfig(),
      requestedSkillId: 'internet-research',
    });

    expect(result.skill?.id).toBe('internet-research');
    expect(result.intent).toBe('casual');
    expect(result.model).toBe('chat-mock');
    expect(result.reply).toBe('hasil akhir');
    expect(result.reach).toEqual({
      channel: 'search',
      backend: 'mock-search',
      sources: ['https://example.com'],
    });
  });

  test('handleWebChat validates empty input and uses local tool route', async () => {
    const empty = await handleWebChat({ message: '   ' });
    expect(empty.route).toBe('validation');

    const tool = await handleWebChat({ message: 'hitung 9 * 9' });
    expect(tool.route).toBe('tool');
    expect(tool.model).toBe('local');
    expect(tool.reply).toContain('81');
  });

  test('handleWebChat returns export metadata for humanis markdown request', async () => {
    mock.module(join(process.cwd(), 'lib/skill-chat.ts'), () => ({
      runSkillChat: async () => ({
        reply: 'isi penjelasan humanis',
        route: 'skill_ai',
        skill: { id: 'penjelasan-humanis', title: 'Penjelasan Humanis' },
        model: 'gemini-2.5-flash',
        intent: 'casual',
        intentModel: 'gemini-2.5-flash-lite',
        latencyMs: 12,
        knowledgeMatches: [],
        fallback: false,
        reach: null,
        exportFile: {
          fileName: 'dummy-export.md',
          format: 'md',
          outputPath: '/tmp/dummy-export.md',
        },
      }),
    }));

    const { handleWebChat: freshHandleWebChat } = await importFresh<typeof import('../lib/web-chat')>('lib/web-chat.ts');
    const result = await freshHandleWebChat({
      message: 'Buatkan file markdown, jelaskan MCP dengan bahasa awam dan kasih analogi',
      skillId: 'penjelasan-humanis',
    });

    expect(result.route).toBe('skill_ai');
    expect(result.skill?.id).toBe('penjelasan-humanis');
    expect(result.exportFile?.format).toBe('md');
    expect(result.exportFile?.downloadUrl).toContain('/api/exports/');
  });
});

describe('api endpoints', () => {
  test('public pages and service endpoints return success', async () => {
    const root = await app.request('/');
    const chat = await app.request('/chat');
    const dashboard = await app.request('/dashboard');
    const health = await app.request('/health');
    const skills = await app.request('/api/chat/skills');
    const reach = await app.request('/api/agent-reach/status');

    expect(root.status).toBe(200);
    expect(chat.status).toBe(200);
    expect(dashboard.status).toBe(200);
    expect((await health.json() as { status: string }).status).toBe('ok');
    expect((await skills.json() as { skills: Array<{ id: string }> }).skills.map((item) => item.id)).toContain('grill-me');
    expect((await reach.json() as { channels: Array<{ id: string }> }).channels.map((item) => item.id)).toContain('search');
  });

  test('managed export endpoint serves markdown files', async () => {
    const exported = await materializeHumanisMarkdown('Penjelasan MCP', '# Halo\n\nIsi file');
    const response = await app.request(`/api/exports/${encodeURIComponent(exported.fileName)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Halo');
  });

  test('api chat validates body and serves tool responses', async () => {
    const invalid = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(invalid.status).toBe(400);

    const valid = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hitung 5 + 7' }),
    });
    const json = await valid.json() as { route: string; model: string; reply: string; intent?: string };
    expect(valid.status).toBe(200);
    expect(json.route).toBe('tool');
    expect(json.model).toBe('local');
    expect(json.reply).toContain('12');
  });

  test('admin endpoints reject unauthorized requests', async () => {
    const urls = [
      '/admin/insights',
      '/admin/quota',
      '/admin/config',
      '/admin/knowledge',
    ];

    for (const url of urls) {
      const response = await app.request(url);
      expect(response.status).toBe(401);
    }

    const postConfig = await app.request('/admin/config', { method: 'POST', body: '{}' });
    expect(postConfig.status).toBe(401);
  });

  test('admin config endpoints read and update runtime config', async () => {
    const getResponse = await app.request('/admin/config', { headers: adminHeaders });
    expect(getResponse.status).toBe(200);

    const postResponse = await app.request('/admin/config', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        personaOverride: 'jawab santai',
        enabledTools: { math: false, caption: true, announcement: true, faq: true },
      }),
    });
    const json = await postResponse.json() as { ok: boolean; config: { personaOverride: string; enabledTools: { math: boolean } } };
    expect(json.ok).toBe(true);
    expect(json.config.personaOverride).toBe('jawab santai');
    expect(json.config.enabledTools.math).toBe(false);
  });

  test('admin knowledge endpoints create, list, and delete documents', async () => {
    const invalid = await app.request('/admin/knowledge', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ title: 'Kosong' }),
    });
    expect(invalid.status).toBe(400);

    const created = await app.request('/admin/knowledge', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ id: 'uji', title: 'Uji', content: 'Isi knowledge' }),
    });
    expect(created.status).toBe(200);

    const listed = await app.request('/admin/knowledge', { headers: adminHeaders });
    const listedJson = await listed.json() as { items: Array<{ id: string }> };
    expect(listedJson.items.map((item) => item.id)).toContain('uji');

    const deleted = await app.request('/admin/knowledge/uji', {
      method: 'DELETE',
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect((await deleted.json() as { ok: boolean }).ok).toBe(true);
  });

  test('admin preferences reset endpoint clears stored preferences', async () => {
    await saveUserPreferences(55, { preferredName: 'Feri', tone: 'formal' });
    expect((await getUserPreferences(55)).preferredName).toBe('Feri');

    const missing = await app.request('/admin/preferences/reset', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const response = await app.request('/admin/preferences/reset', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ userId: 55 }),
    });
    expect((await response.json() as { ok: boolean }).ok).toBe(true);
    expect(await getUserPreferences(55)).toEqual({});
  });

  test('admin insights and quota endpoints return structured payloads', async () => {
    await logEvent('message.completed', { route: 'tool', durationMs: 20 });
    const insights = await app.request('/admin/insights', { headers: { 'x-admin-token': 'test-admin-token' } });
    const quota = await app.request('/admin/quota', { headers: { 'x-admin-token': 'test-admin-token' } });

    expect(insights.status).toBe(200);
    expect(quota.status).toBe(200);

    const insightsJson = await insights.json() as { routeBreakdown: unknown[]; topUsers: unknown[] };
    const quotaJson = await quota.json() as { provider: string; activeModel: string };
    expect(Array.isArray(insightsJson.routeBreakdown)).toBe(true);
    expect(Array.isArray(insightsJson.topUsers)).toBe(true);
    expect(typeof quotaJson.provider).toBe('string');
    expect(typeof quotaJson.activeModel).toBe('string');
  });

  test('webhook endpoint returns a bounded HTTP response for minimal payload', async () => {
    const response = await app.request('/api/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(600);
  });
});
