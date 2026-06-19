import { existsSync, mkdirSync, rmSync } from 'fs';
import { basename, join, resolve } from 'path';

const EXPORT_DIR = process.env.EXPORT_DIR?.trim() || '/tmp/cybrabot-exports';
mkdirSync(EXPORT_DIR, { recursive: true });

export type HumanisExportFile = {
  outputPath: string;
  fileName: string;
  format: 'md';
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'penjelasan-humanis';
}

function inferTitle(prompt: string) {
  const cleaned = prompt
    .replace(/\b(markdown|md|file|berkas|dokumen)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const firstSegment = cleaned.split(/[.!?\n]/)[0] || '';
  return firstSegment.slice(0, 70).trim() || 'Penjelasan Humanis';
}

export function detectHumanisMarkdownRequest(text: string) {
  const lower = text.toLowerCase();
  const asksToCreate =
    /(buatkan|bikinkan|generate|tolong buat|tolong bikin|jadikan|ekspor|export|kirimkan|kirim)/.test(lower);
  const wantsMarkdown =
    /\bmarkdown\b/.test(lower) ||
    /\b\.md\b/.test(lower) ||
    /\bmd\b/.test(lower) ||
    lower.includes('sebagai file') ||
    lower.includes('dalam file') ||
    lower.includes('kirim file') ||
    lower.includes('kirimkan file');

  if (!asksToCreate || !wantsMarkdown) {
    return null;
  }

  return {
    title: inferTitle(text),
    format: 'md' as const,
  };
}

export async function materializeHumanisMarkdown(title: string, content: string): Promise<HumanisExportFile> {
  const fileName = `${slugify(title)}.md`;
  const outputPath = join(EXPORT_DIR, `${Date.now()}-${crypto.randomUUID()}-${fileName}`);
  await Bun.write(outputPath, content.trimEnd() + '\n');

  return {
    outputPath,
    fileName: basename(outputPath),
    format: 'md',
  };
}

export function resolveManagedExportPath(fileName: string) {
  const safeName = basename(fileName);
  const outputPath = resolve(EXPORT_DIR, safeName);
  if (!outputPath.startsWith(resolve(EXPORT_DIR))) {
    return null;
  }
  if (!existsSync(outputPath)) {
    return null;
  }
  return outputPath;
}

export function cleanupManagedExportFile(path: string) {
  rmSync(path, { force: true });
}
