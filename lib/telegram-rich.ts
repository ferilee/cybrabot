export function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function flushParagraph(lines: string[], output: string[]) {
  if (!lines.length) {
    return;
  }

  const content = lines
    .map((line) => escapeHtml(line.trim()))
    .join(' ');

  if (content) {
    output.push(content);
  }

  lines.length = 0;
}

export function formatTelegramRichText(input: string) {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const output: string[] = [];
  const paragraphLines: string[] = [];
  const quoteLines: string[] = [];
  const listItems: { ordered: boolean; items: string[] } = { ordered: false, items: [] };
  const codeLines: string[] = [];

  let inCode = false;

  const flushQuote = () => {
    if (!quoteLines.length) {
      return;
    }
    output.push(`<blockquote>${quoteLines.map((line) => escapeHtml(line.trim())).join('\n')}</blockquote>`);
    quoteLines.length = 0;
  };

  const flushList = () => {
    if (!listItems.items.length) {
      return;
    }
    const tag = listItems.ordered ? 'ol' : 'ul';
    output.push(`<${tag}>${listItems.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`);
    listItems.items.length = 0;
    listItems.ordered = false;
  };

  const flushCode = () => {
    if (!codeLines.length) {
      return;
    }
    output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines.length = 0;
  };

  const flushAll = () => {
    flushParagraph(paragraphLines, output);
    flushQuote();
    flushList();
    flushCode();
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.*)$/);
    if (heading?.[1]) {
      flushAll();
      output.push(`<b>${escapeHtml(heading[1])}</b>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote?.[1]) {
      flushParagraph(paragraphLines, output);
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet?.[1]) {
      flushParagraph(paragraphLines, output);
      flushQuote();
      listItems.items.push(bullet[1]);
      continue;
    }

    const ordered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (ordered?.[2]) {
      flushParagraph(paragraphLines, output);
      flushQuote();
      listItems.ordered = true;
      listItems.items.push(ordered[2]);
      continue;
    }

    flushQuote();
    flushList();
    paragraphLines.push(trimmed);
  }

  flushAll();

  return output.join('\n\n');
}
