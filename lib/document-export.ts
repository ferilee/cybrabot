import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { InputFile } from 'grammy';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  Footer,
  PageNumber,
  AlignmentType,
  TabStopType,
} from 'docx';
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import * as XLSX from 'xlsx';

const EXPORT_DIR = '/tmp/cybrabot-exports';
mkdirSync(EXPORT_DIR, { recursive: true });

export type ExportFormat = 'md' | 'pdf' | 'docx' | 'xlsx';

export type ExportRequest = {
  format: ExportFormat;
  prompt: string;
  title: string;
};

export function getExportProcessingMessage(format: ExportFormat) {
  if (format === 'md') {
    return 'Siap kak, skill aktif! Tunggu sebentar yaaa ... sedang kuproses';
  }

  return `Sedang menyiapkan file <b>${format.toUpperCase()}</b> untuk permintaan Kakak.`;
}

type ParsedLine =
  | { type: 'heading1'; text: string }
  | { type: 'heading2'; text: string }
  | { type: 'heading3'; text: string }
  | { type: 'heading4'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'keyvalue'; key: string; value: string };

export function detectDocumentExportRequest(text: string): ExportRequest | null {
  const lower = text.toLowerCase();
  const wantsMd = /\bmarkdown\b|\bmd\b/.test(lower);
  const wantsPdf = /\bpdf\b/.test(lower);
  const wantsDocx = /\bdocx\b|\bword\b/.test(lower);
  const wantsXlsx = /\bxlsx\b|\bexcel\b/.test(lower);
  const asksToCreate = /(buatkan|bikinkan|generate|buat|tolong buat|tolong bikin|jadikan|ubah jadi|convert|ekspor|export|kirimkan|kirim)/.test(lower);

  if (!asksToCreate || (!wantsMd && !wantsPdf && !wantsDocx && !wantsXlsx)) {
    return null;
  }

  const format: ExportFormat = wantsMd ? 'md' : wantsPdf ? 'pdf' : wantsDocx ? 'docx' : 'xlsx';
  const cleanedPrompt = text
    .replace(/\/?[a-z]*dokumen(@\w+)?/gi, '')
    .replace(/\b(format|dalam bentuk|sebagai)\b/gi, '')
    .replace(/\bmarkdown\b/gi, '')
    .replace(/\bmd\b/gi, '')
    .replace(/\bpdf\b/gi, '')
    .replace(/\bdocx\b/gi, '')
    .replace(/\bword\b/gi, '')
    .replace(/\bxlsx\b/gi, '')
    .replace(/\bexcel\b/gi, '')
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

function cleanMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\$\$(.*?)\$\$/g, '$1')
    .replace(/\$(.*?)\$/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`(.*?)`/g, '$1');
}

function parseStructuredText(content: string): ParsedLine[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ParsedLine => {
      let isBullet = false;
      let text = line;
      let type: ParsedLine['type'] = 'paragraph';
      if (line.startsWith('# ')) { type = 'heading1'; text = line.slice(2).trim(); }
      else if (line.startsWith('## ')) { type = 'heading2'; text = line.slice(3).trim(); }
      else if (line.startsWith('### ')) { type = 'heading3'; text = line.slice(4).trim(); }
      else if (line.startsWith('#### ')) { type = 'heading4'; text = line.slice(5).trim(); }
      else if (line.startsWith('- ')) { isBullet = true; text = line.slice(2).trim(); }
      else if (line.startsWith('* ')) { isBullet = true; text = line.slice(2).trim(); }
      
      let cleanedText = cleanMarkdown(text);
      if (type === 'paragraph' || isBullet) {
        let kvMatch = cleanedText.match(/^([a-zA-Z0-9\s/_-]{2,35}?)\s*:\s*(.+)$/);
        if (kvMatch) {
          return {
            type: 'keyvalue',
            key: (isBullet ? '• ' : '') + kvMatch[1].trim(),
            value: kvMatch[2].trim(),
          } as ParsedLine;
        }
      }
      
      if (isBullet) type = 'bullet';
      return { type, text: cleanedText } as ParsedLine;
    });
}

export async function createDocxDocument(title: string, content: string) {
  const lines = parseStructuredText(content);
  const doc = new Document({
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun("Halaman "),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                  }),
                  new TextRun(" dari "),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                  }),
                  new TextRun(" • Dibuat dengan ❤️ oleh Dianyssa"),
                ],
              }),
            ],
          }),
        },
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
            if (line.type === 'heading3') {
              return new Paragraph({
                text: line.text,
                heading: HeadingLevel.HEADING_3,
              });
            }
            if (line.type === 'heading4') {
              return new Paragraph({
                text: line.text,
                heading: HeadingLevel.HEADING_4,
              });
            }
            if (line.type === 'bullet') {
              return new Paragraph({
                text: line.text,
                bullet: { level: 0 },
              });
            }
            if (line.type === 'keyvalue') {
              return new Paragraph({
                tabStops: [{ type: TabStopType.LEFT, position: 2800 }],
                children: [
                  new TextRun({ text: line.key + ' :', bold: true }),
                  new TextRun({ text: '\t' + line.value }),
                ],
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

function sanitizeForWinAnsi(text: string) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25E6\u2043\u2219]/g, '-')
    .replace(/[^\x00-\xFF]/g, '');
}

export async function createPdfDocument(title: string, content: string) {
  const safeTitle = sanitizeForWinAnsi(title);
  const safeContent = sanitizeForWinAnsi(content);
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

  drawLine(safeTitle, { bold: true, size: 18 });
  y -= 4;

  for (const line of parseStructuredText(safeContent)) {
    ensureSpace();
    if (line.type === 'heading1') {
      drawLine(line.text, { bold: true, size: 15 });
      continue;
    }
    if (line.type === 'heading2') {
      drawLine(line.text, { bold: true, size: 13 });
      continue;
    }
    if (line.type === 'heading3') {
      drawLine(line.text, { bold: true, size: 12 });
      continue;
    }
    if (line.type === 'heading4') {
      drawLine(line.text, { bold: true, size: 11 });
      continue;
    }

    if (line.type === 'keyvalue') {
      ensureSpace();
      drawLine(line.key + ' :', { bold: true });
      y += 17; // rewind Y since drawLine moved it down
      const valueX = margin + 140;
      const wrapped = wrapText(line.value, 70);
      for (let i = 0; i < wrapped.length; i++) {
        page.drawText(wrapped[i], { x: valueX, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 17;
        if (i < wrapped.length - 1) ensureSpace();
      }
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

  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pageToDraw = pages[i];
    const footerText = `Halaman ${i + 1} / ${pages.length}  -  Dibuat dengan <3 oleh Dianyssa`;
    const textWidth = font.widthOfTextAtSize(footerText, 9);
    pageToDraw.drawText(footerText, {
      x: (pageToDraw.getWidth() - textWidth) / 2,
      y: 30,
      size: 9,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return Buffer.from(await pdfDoc.save());
}

export async function createXlsxDocument(title: string, content: string) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const data: any[][] = [[title], []];
  
  for (const line of lines) {
    if (line.includes('|') && !line.includes('---')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      data.push(cells);
    } else if (!line.includes('---')) {
      if (line.startsWith('#')) {
        data.push([]);
        data.push([line.replace(/^#+\s/, '')]);
      } else if (line.startsWith('- ')) {
        data.push(['', line.slice(2)]);
      } else {
        data.push([line]);
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buffer);
}

export async function materializeExportFile(title: string, content: string, format: ExportFormat) {
  const fileName = `${slugify(title)}.${format}`;
  const outputPath = join(EXPORT_DIR, `${Date.now()}-${crypto.randomUUID()}-${fileName}`);
  const buffer =
    format === 'md'
      ? Buffer.from(content, 'utf-8')
      : format === 'pdf'
        ? await createPdfDocument(title, content)
        : format === 'docx'
          ? await createDocxDocument(title, content)
          : await createXlsxDocument(title, content);

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
