import { spawnSync } from 'bun';

export type AgentReachChannelId = 'web' | 'github' | 'youtube' | 'search';

export type AgentReachChannelStatus = {
  id: AgentReachChannelId;
  title: string;
  available: boolean;
  backend: string;
  detail: string;
};

export type AgentReachResult = {
  channel: AgentReachChannelId;
  backend: string;
  query: string;
  content: string;
  sources: string[];
};

const MAX_CONTENT_LENGTH = Number(process.env.AGENT_REACH_MAX_CHARS || 12000);
const REQUEST_TIMEOUT_MS = Number(process.env.AGENT_REACH_TIMEOUT_MS || 15000);

function commandExists(command: string) {
  return Bun.which(command) !== null;
}

function runCommand(cmd: string[]) {
  const result = spawnSync({
    cmd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

function truncateContent(content: string) {
  const trimmed = content.replace(/\n{3,}/g, '\n\n').trim();
  if (trimmed.length <= MAX_CONTENT_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_CONTENT_LENGTH)}\n\n[content truncated]`;
}

function isUrl(text: string) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function extractFirstUrl(text: string) {
  return text.match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/, '') || '';
}

function extractGitHubRepo(text: string) {
  const urlMatch = text.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (urlMatch?.[1] && urlMatch?.[2]) {
    return `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, '')}`;
  }

  const repoMatch = text.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/);
  if (repoMatch?.[1] && repoMatch?.[2]) {
    return `${repoMatch[1]}/${repoMatch[2].replace(/\.git$/, '')}`;
  }

  return '';
}

function buildJinaReaderUrl(url: string) {
  return `https://r.jina.ai/${url}`;
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, text/markdown, */*',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readWeb(target: string): Promise<AgentReachResult> {
  const url = extractFirstUrl(target) || target.trim();
  if (!isUrl(url)) {
    throw new Error('Kanal web membutuhkan URL lengkap http/https.');
  }

  const readerUrl = buildJinaReaderUrl(url);
  const response = await fetchWithTimeout(readerUrl);
  if (!response.ok) {
    throw new Error(`Jina Reader merespons ${response.status}`);
  }

  const content = await response.text();
  return {
    channel: 'web',
    backend: 'jina-reader',
    query: url,
    content: truncateContent(content),
    sources: [url],
  };
}

async function readGitHub(target: string): Promise<AgentReachResult> {
  const repo = extractGitHubRepo(target);
  if (!repo) {
    throw new Error('Kanal GitHub membutuhkan URL repo atau format owner/repo.');
  }

  if (commandExists('gh')) {
    const result = runCommand(['gh', 'repo', 'view', repo, '--json', 'nameWithOwner,description,url,stargazerCount,forkCount,issues']);
    if (result.ok && result.stdout) {
      return {
        channel: 'github',
        backend: 'gh-cli',
        query: repo,
        content: truncateContent(result.stdout),
        sources: [`https://github.com/${repo}`],
      };
    }
  }

  const response = await fetchWithTimeout(`https://api.github.com/repos/${repo}`);
  if (!response.ok) {
    throw new Error(`GitHub API merespons ${response.status}`);
  }

  const data = await response.json();
  return {
    channel: 'github',
    backend: 'github-rest',
    query: repo,
    content: truncateContent(JSON.stringify(data, null, 2)),
    sources: [`https://github.com/${repo}`],
  };
}

async function readYouTube(target: string): Promise<AgentReachResult> {
  if (!commandExists('yt-dlp')) {
    throw new Error('yt-dlp belum tersedia di environment ini.');
  }

  const url = extractFirstUrl(target) || target.trim();
  const result = runCommand(['yt-dlp', '--skip-download', '--write-auto-subs', '--sub-lang', 'id,en', '--sub-format', 'vtt', '--print', '%(title)s\n%(webpage_url)s', url]);
  if (!result.ok) {
    throw new Error(result.stderr || 'yt-dlp gagal membaca YouTube.');
  }

  return {
    channel: 'youtube',
    backend: 'yt-dlp',
    query: url,
    content: truncateContent(result.stdout),
    sources: [url],
  };
}

async function searchWeb(query: string): Promise<AgentReachResult> {
  const encoded = encodeURIComponent(query);
  const url = buildJinaReaderUrl(`http://www.google.com/search?q=${encoded}`);
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Search reader merespons ${response.status}`);
  }

  return {
    channel: 'search',
    backend: 'jina-reader-search',
    query,
    content: truncateContent(await response.text()),
    sources: [`https://www.google.com/search?q=${encoded}`],
  };
}

export function getAgentReachStatus(): AgentReachChannelStatus[] {
  return [
    {
      id: 'web',
      title: 'Web',
      available: true,
      backend: 'jina-reader',
      detail: 'Membaca halaman publik via r.jina.ai.',
    },
    {
      id: 'github',
      title: 'GitHub',
      available: true,
      backend: commandExists('gh') ? 'gh-cli' : 'github-rest',
      detail: commandExists('gh') ? 'gh CLI tersedia.' : 'Fallback ke GitHub REST publik.',
    },
    {
      id: 'youtube',
      title: 'YouTube',
      available: commandExists('yt-dlp'),
      backend: 'yt-dlp',
      detail: commandExists('yt-dlp') ? 'yt-dlp tersedia.' : 'yt-dlp belum terpasang.',
    },
    {
      id: 'search',
      title: 'Search',
      available: true,
      backend: 'jina-reader-search',
      detail: 'Pencarian ringan via reader publik.',
    },
  ];
}

export function chooseAgentReachChannel(message: string): AgentReachChannelId {
  const lower = message.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('github.com') || /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/.test(message)) return 'github';
  if (extractFirstUrl(message) || lower.includes('baca halaman') || lower.includes('baca web')) return 'web';
  return 'search';
}

export async function runAgentReach(message: string, channel?: AgentReachChannelId) {
  const selected = channel || chooseAgentReachChannel(message);
  if (selected === 'web') return readWeb(message.trim());
  if (selected === 'github') return readGitHub(message);
  if (selected === 'youtube') return readYouTube(message.trim());
  return searchWeb(message);
}
