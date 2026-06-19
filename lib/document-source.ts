import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const MAX_EXTRACTION_CHARS = 30000;
const MAX_XLSX_ROWS_PER_SHEET = 100;
const MAX_XLSX_CELLS_PER_ROW = 20;

function trimContent(text: string) {
  const normalized = text.trim();
  if (normalized.length <= MAX_EXTRACTION_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXTRACTION_CHARS - 40)}\n\n[...dipotong karena terlalu panjang...]`;
}

export function isDocxMimeType(mimeType: string) {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export function isXlsxMimeType(mimeType: string) {
  return mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export function isPdfMimeType(mimeType: string) {
  return mimeType === 'application/pdf';
}

export function isTextDocumentMimeType(mimeType: string) {
  return isDocxMimeType(mimeType) || isXlsxMimeType(mimeType);
}

export async function extractTextFromPdf(filePath: string) {
  const result = Bun.spawnSync({
    cmd: ['pdftotext', '-layout', '-nopgbrk', filePath, '-'],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    return '';
  }

  return trimContent(Buffer.from(result.stdout).toString('utf-8'));
}

export async function detectPdfSourceKind(filePath: string) {
  const extractedText = await extractTextFromPdf(filePath);
  if (extractedText.trim()) {
    return {
      sourceKind: 'text' as const,
      extractedText,
    };
  }

  return {
    sourceKind: 'gemini' as const,
    extractedText: '',
  };
}

export async function extractTextFromDocument(filePath: string, mimeType: string) {
  if (isPdfMimeType(mimeType)) {
    return extractTextFromPdf(filePath);
  }

  if (isDocxMimeType(mimeType)) {
    const result = await mammoth.extractRawText({ path: filePath });
    return trimContent(result.value);
  }

  if (isXlsxMimeType(mimeType)) {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sections = workbook.SheetNames.map((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return `## ${sheetName}\n[Sheet kosong atau tidak terbaca]`;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
        raw: false,
      }) as unknown[][];

      const renderedRows = rows
        .slice(0, MAX_XLSX_ROWS_PER_SHEET)
        .map((row) => row.slice(0, MAX_XLSX_CELLS_PER_ROW).map((cell) => String(cell).trim()).filter(Boolean).join(' | '))
        .filter(Boolean);

      return `## ${sheetName}\n${renderedRows.join('\n')}`;
    });

    return trimContent(sections.join('\n\n'));
  }

  return '';
}
