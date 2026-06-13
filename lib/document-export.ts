import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { InputFile } from 'grammy';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from 'pdf-lib';

const EXPORT_DIR = '/tmp/cybrabot-exports';
mkdirSync(EXPORT_DIR, { recursive: true });

export type ExportFormat = 'pdf' | 'docx';

export type ExportRequest = {
  format: ExportFormat;
  prompt: string;
  title: string;
};

type ParsedLine =
  | { type: 'heading1'; text: string }
  | { type: 'heading2'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string };

export function detectDocumentExportRequest(text: string): ExportRequest | null {
  const lower = text.toLowerCase();
  const wantsPdf = /\bpdf\b/.test(lower);
  const wantsDocx = /\bdocx\b|\bword\b/.test(lower);
  const asksToCreate = /(buatkan|bikinkan|generate|buat|tolong buat|tolong bikin|jadikan|ubah jadi|convert|ekspor|export)/.test(lower);

  if (!asksToCreate || (!wantsPdf && !wantsDocx)) {
    return null;
  }

  const format: ExportFormat = wantsPdf ? 'pdf' : 'docx';
  const cleanedPrompt = text
    .replace(/\/?[a-z]*dokumen(@\w+)?/gi, '')
    .replace(/\b(format|dalam bentuk|sebagai)\b/gi, '')
    .replace(/\bpdf\b/gi, '')
    .replace(/\bdocx\b/gi, '')
    .replace(/\bword\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const title = inferTitle(cleanedPrompt || text);
  return {
    format,
    prompt: cleanedPrompt || text,
    title,
  };
}

function inferTitle(prompt: string) {
  const firstSegment = prompt
    .replace(/^[^a-zA-Z0-9]+/, '')
    .split(/[.!?\n]/)[0]
    || '';

  const sanitized = firstSegment
    .trim()
    .slice(0, 70);

  return sanitized || 'Dokumen CybraFeriBot';
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'dokumen-cybrabot';
}

function parseStructuredText(content: string): ParsedLine[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ParsedLine => {
      if (line.startsWith('# ')) return { type: 'heading1', text: line.slice(2).trim() };
      if (line.startsWith('## ')) return { type: 'heading2', text: line.slice(3).trim() };
      if (line.startsWith('- ')) return { type: 'bullet', text: line.slice(2).trim() };
      return { type: 'paragraph', text: line };
    });
}

export async function createDocxDocument(title: string, content: string) {
  const lines = parseStructuredText(content);
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
          }),
          ...lines.map((line) => {
            if (line.type === 'heading1') {
              return new Paragraph({
                text: line.text,
                heading: HeadingLevel.HEADING_1,
              });
            }
            if (line.type === 'heading2') {
              return new Paragraph({
                text: line.text,
                heading: HeadingLevel.HEADING_2,
              });
            }
            if (line.type === 'bullet') {
              return new Paragraph({
                text: line.text,
                bullet: { level: 0 },
              });
            }
            return new Paragraph({
              children: [new TextRun(line.text)],
            });
          }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function wrapText(text: string, maxChars = 95) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function createPdfDocument(title: string, content: string) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const pageHeight = page.getHeight();
  let y = pageHeight - margin;

  const drawLine = (text: string, options?: { bold?: boolean; size?: number; indent?: number }) => {
    const size = options?.size || 11;
    const fontToUse = options?.bold ? boldFont : font;
    const indent = options?.indent || 0;
    page.drawText(text, {
      x: margin + indent,
      y,
      size,
      font: fontToUse,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 6;
  };

  const ensureSpace = (needed = 24) => {
    if (y > margin + needed) return;
    page = pdfDoc.addPage([595.28, 841.89]);
    y = page.getHeight() - margin;
  };

  drawLine(title, { bold: true, size: 18 });
  y -= 4;

  for (const line of parseStructuredText(content)) {
    ensureSpace();
    if (line.type === 'heading1') {
      drawLine(line.text, { bold: true, size: 15 });
      continue;
    }
    if (line.type === 'heading2') {
      drawLine(line.text, { bold: true, size: 13 });
      continue;
    }

    const prefix = line.type === 'bullet' ? '• ' : '';
    const wrapped = wrapText(`${prefix}${line.text}`);
    for (const wrappedLine of wrapped) {
      ensureSpace();
      drawLine(wrappedLine, { indent: line.type === 'bullet' ? 10 : 0 });
    }
    y -= 4;
  }

  return Buffer.from(await pdfDoc.save());
}

export async function materializeExportFile(title: string, content: string, format: ExportFormat) {
  const fileName = `${slugify(title)}.${format}`;
  const outputPath = join(EXPORT_DIR, `${Date.now()}-${crypto.randomUUID()}-${fileName}`);
  const buffer = format === 'pdf'
    ? await createPdfDocument(title, content)
    : await createDocxDocument(title, content);

  await Bun.write(outputPath, buffer);

  return {
    outputPath,
    fileName,
    inputFile: new InputFile(outputPath, fileName),
  };
}

export function cleanupExportFile(path: string) {
  rmSync(path, { force: true });
}
