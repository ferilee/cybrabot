import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  tokens: string[];
};

const knowledgeDir = process.env.KNOWLEDGE_DIR?.trim() || join(import.meta.dir, '..', 'knowledge');
mkdirSync(knowledgeDir, { recursive: true });

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function loadKnowledgeDocuments(): KnowledgeDocument[] {
  const files = readdirSync(knowledgeDir).filter((file) => file.endsWith('.md'));

  return files.map((file) => {
    const content = readFileSync(join(knowledgeDir, file), 'utf8');
    const [firstLine = file, ...rest] = content.split('\n');
    const title = firstLine.replace(/^#\s*/, '').trim();
    const body = rest.join('\n').trim();

    return {
      id: file.replace(/\.md$/, ''),
      title,
      content: body,
      tokens: tokenize(`${title}\n${body}`),
    };
  });
}

let knowledgeDocuments = loadKnowledgeDocuments();

function toMarkdown(title: string, content: string) {
  return `# ${title}\n\n${content.trim()}\n`;
}

function slugify(input: string) {
  return normalize(input)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || `doc-${Date.now()}`;
}

export function reloadKnowledgeDocuments() {
  knowledgeDocuments = loadKnowledgeDocuments();
  return knowledgeDocuments;
}

export function retrieveKnowledge(query: string, limit = 2) {
  const queryTokens = new Set(tokenize(query));

  if (!queryTokens.size) {
    return [];
  }

  return knowledgeDocuments
    .map((doc) => {
      const score = doc.tokens.reduce((total, token) => total + (queryTokens.has(token) ? 1 : 0), 0);
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc }) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
    }));
}

export function listKnowledgeDocuments() {
  return knowledgeDocuments.map((doc) => ({
    id: doc.id,
    title: doc.title,
    content: doc.content,
  }));
}

export function saveKnowledgeDocument(input: { id?: string; title: string; content: string }) {
  const id = input.id || slugify(input.title);
  const filePath = join(knowledgeDir, `${id}.md`);
  writeFileSync(filePath, toMarkdown(input.title, input.content), 'utf8');
  reloadKnowledgeDocuments();
  return {
    id,
    title: input.title,
    content: input.content.trim(),
  };
}

export function deleteKnowledgeDocument(id: string) {
  const filePath = join(knowledgeDir, `${id}.md`);
  rmSync(filePath, { force: true });
  reloadKnowledgeDocuments();
}

export function formatKnowledgeContext(query: string) {
  const matches = retrieveKnowledge(query);

  if (!matches.length) {
    return '';
  }

  const sections = matches.map((item) => `[${item.title}]\n${item.content}`);
  return `Pengetahuan lokal yang relevan:\n${sections.join('\n\n')}\n\n`;
}

export function getKnowledgeContext(query: string) {
  const matches = retrieveKnowledge(query);

  if (!matches.length) {
    return {
      context: '',
      matches: [],
    };
  }

  const sections = matches.map((item) => `[${item.title}]\n${item.content}`);
  return {
    context: `Pengetahuan lokal yang relevan:\n${sections.join('\n\n')}\n\n`,
    matches: matches.map((item) => item.id),
  };
}
