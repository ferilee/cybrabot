export function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

type PlaceholderMap = Map<string, string>;

function createPlaceholderStore() {
  const placeholders: PlaceholderMap = new Map();
  let index = 0;

  const stash = (html: string, prefix = 'TGRICH') => {
    const key = `§§${prefix}${index++}§§`;
    placeholders.set(key, html);
    return key;
  };

  return { placeholders, stash };
}

function restorePlaceholders(text: string, placeholders: PlaceholderMap) {
  let restored = text;
  for (const [key, value] of placeholders) {
    restored = restored.replaceAll(key, value);
  }
  return restored;
}

function normalizeMathExpression(input: string) {
  return input
    .replace(/(?<!\\)\bsin(?=\s+[A-Za-z(]|\s*\\?[A-Za-z]|[([])/gi, '\\sin')
    .replace(/(?<!\\)\bcos(?=\s+[A-Za-z(]|\s*\\?[A-Za-z]|[([])/gi, '\\cos')
    .replace(/(?<!\\)\btan(?=\s+[A-Za-z(]|\s*\\?[A-Za-z]|[([])/gi, '\\tan')
    .replace(/(?<!\\)\bcot(?=\s+[A-Za-z(]|\s*\\?[A-Za-z]|[([])/gi, '\\cot')
    .replace(/(?<!\\)\bsec(?=\s+[A-Za-z(]|\s*\\?[A-Za-z]|[([])/gi, '\\sec')
    .replace(/(?<!\\)\bcsc(?=\s+[A-Za-z(]|\s*\\?[A-Za-z]|[([])/gi, '\\csc')
    .replace(/(?<!\\)\bsqrt\s*\(\s*([^)]+?)\s*\)/gi, '\\sqrt{$1}')
    .replace(/\(([^()\n]+)\)\s*\/\s*\(([^()\n]+)\)/g, '\\frac{$1}{$2}')
    .replace(
      /(\\(?:sin|cos|tan|cot|sec|csc)\s+(?:[A-Za-z0-9]|\{[^}]+\}))\s*\/\s*(\\(?:sin|cos|tan|cot|sec|csc)\s+(?:[A-Za-z0-9]|\{[^}]+\}))/g,
      '\\frac{$1}{$2}'
    )
    .replace(/\b([A-Za-z0-9]+(?:\^[A-Za-z0-9{}]+)?)\s*\/\s*([A-Za-z0-9]+(?:\^[A-Za-z0-9{}]+)?)\b/g, '\\frac{$1}{$2}');
}

function prepareMathPlaceholders(input: string) {
  const { placeholders, stash } = createPlaceholderStore();
  let text = input;

  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) =>
    stash(`<tg-math-block>${normalizeMathExpression(expr.trim())}</tg-math-block>`, 'TGMATH')
  );
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) =>
    stash(`<tg-math-block>${normalizeMathExpression(expr.trim())}</tg-math-block>`, 'TGMATH')
  );
  text = text.replace(/\\\((.+?)\\\)/g, (_, expr) =>
    stash(`<tg-math>${normalizeMathExpression(expr.trim())}</tg-math>`, 'TGMATH')
  );
  text = text.replace(/(^|[^\$])\$([^\n$]+?)\$/g, (_, prefix, expr) =>
    `${prefix}${stash(`<tg-math>${normalizeMathExpression(expr.trim())}</tg-math>`, 'TGMATH')}`
  );

  return { text, placeholders };
}

function normalizeStandaloneMathBlocks(input: string) {
  return input
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      if (
        trimmed.includes('$$') ||
        /\$[^$\n]+\$/.test(trimmed) ||
        trimmed.includes('\\(') ||
        trimmed.includes('\\[') ||
        trimmed.includes('<tg-math') ||
        /https?:\/\//i.test(trimmed) ||
        /(?:^|\s)(?:\/[A-Za-z0-9._-]+){2,}/.test(trimmed) ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('- ') ||
        trimmed.startsWith('* ') ||
        trimmed.startsWith('> ')
      ) {
        return line;
      }

      const normalizedMath = normalizeMathExpression(trimmed);
      const looksLikeEquation =
        normalizedMath.length <= 120 &&
        /(=|\\frac|\\sin|\\cos|\\tan|\\sqrt|\^|_[{(]?)/
          .test(normalizedMath) &&
        !/[.!?]$/.test(normalizedMath);

      if (!looksLikeEquation) {
        return line;
      }

      return `$$${normalizedMath}$$`;
    })
    .join('\n');
}

function formatInlineTelegramRichText(input: string) {
  const { placeholders, stash } = createPlaceholderStore();
  const mathPrepared = prepareMathPlaceholders(input);
  let text = escapeHtml(mathPrepared.text);

  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    stash(`<a href="${escapeHtml(url)}">${label}</a>`)
  );

  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${code}</code>`));
  text = text.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<b>$1</b>');
  text = text.replace(/__([^_\n][\s\S]*?[^_\n])__/g, '<b>$1</b>');
  text = text.replace(/\*([^*\n][^*\n]*?[^*\n])\*/g, '<i>$1</i>');
  text = text.replace(/_([^_\n][^_\n]*?[^_\n])_/g, '<i>$1</i>');
  text = text.replace(/~~([^~\n][\s\S]*?[^~\n])~~/g, '<s>$1</s>');

  return restorePlaceholders(restorePlaceholders(text, placeholders), mathPrepared.placeholders);
}

export function formatTelegramRichCard(input: {
  title: string;
  subtitle?: string;
  badge?: string;
  fields: Array<{ label: string; value: string }>;
  footer?: string;
}) {
  return formatTelegramRichCardWithBody({
    ...input,
    bodyHtml: '',
  });
}

export function formatTelegramRichCardWithBody(input: {
  title: string;
  subtitle?: string;
  badge?: string;
  fields: Array<{ label: string; value: string }>;
  bodyHtml?: string;
  footer?: string;
}) {
  const parts: string[] = [];
  const titleLine = `<b>${escapeHtml(input.title)}</b>`;
  const badgeLine = input.badge ? ` <code>${escapeHtml(input.badge)}</code>` : '';

  parts.push(`${titleLine}${badgeLine}`);

  if (input.subtitle) {
    parts.push(`<i>${escapeHtml(input.subtitle)}</i>`);
  }

  for (const field of input.fields) {
    parts.push(`◆ <b>${escapeHtml(field.label)}:</b> ${field.value}`);
  }

  if (input.bodyHtml) {
    parts.push(input.bodyHtml);
  }

  if (input.footer) {
    parts.push(`\n${input.footer}`);
  }

  return parts.join('\n');
}

function flushParagraph(lines: string[], output: string[]) {
  if (!lines.length) {
    return;
  }

  const content = lines
    .map((line) => formatInlineTelegramRichText(line.trim()))
    .join(' ');

  if (content) {
    output.push(content);
  }

  lines.length = 0;
}

export function formatTelegramRichText(input: string) {
  const preparedMath = prepareMathPlaceholders(input.replace(/\r\n/g, '\n'));
  const normalized = preparedMath.text.trim();
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
    output.push(`<blockquote>${quoteLines.map((line) => formatInlineTelegramRichText(line.trim())).join('\n')}</blockquote>`);
    quoteLines.length = 0;
  };

  const flushList = () => {
    if (!listItems.items.length) {
      return;
    }
    const tag = listItems.ordered ? 'ol' : 'ul';
    output.push(`<${tag}>${listItems.items.map((item) => `<li>${formatInlineTelegramRichText(item)}</li>`).join('')}</${tag}>`);
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
      output.push(`<b>${formatInlineTelegramRichText(heading[1])}</b>`);
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

  return restorePlaceholders(output.join('\n\n'), preparedMath.placeholders);
}

export function containsTelegramHtml(input: string) {
  return /<\/?(b|strong|i|em|u|s|code|pre|blockquote|a|ul|ol|li)\b[^>]*>/i.test(input);
}

export function renderTelegramMessageContent(input: string) {
  const normalized = normalizeStandaloneMathBlocks(input.replace(/\r\n/g, '\n')).trim();
  if (!normalized) {
    return '';
  }

  if (containsTelegramHtml(normalized)) {
    const preparedMath = prepareMathPlaceholders(normalized);
    return restorePlaceholders(preparedMath.text, preparedMath.placeholders);
  }

  return formatTelegramRichText(normalized);
}
