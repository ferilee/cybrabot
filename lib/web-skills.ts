import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

export type WebSkill = {
  id: string;
  title: string;
  description: string;
  triggers: string[];
  modelHint?: string;
  instructions: string;
};

const skillsDir = join(import.meta.dir, '..', 'skills');

const fallbackSkills: WebSkill[] = [
  {
    id: 'general-chat',
    title: 'General Chat',
    description: 'Menjawab pertanyaan umum dengan jelas dan ringkas.',
    triggers: ['tanya', 'jelaskan', 'apa', 'bagaimana', 'kenapa', 'siapa'],
    modelHint: 'chat',
    instructions: 'Jawab pertanyaan user dengan bahasa Indonesia yang jelas, praktis, dan terstruktur.',
  },
  {
    id: 'technical-helper',
    title: 'Technical Helper',
    description: 'Membantu debugging, coding, deployment, dan konfigurasi teknis.',
    triggers: ['error', 'bug', 'kode', 'deploy', 'docker', 'github', 'api', 'database', 'server', 'konfigurasi'],
    modelHint: 'chat',
    instructions: 'Bantu user menyelesaikan masalah teknis secara praktis. Beri langkah konkret, asumsi, dan verifikasi.',
  },
  {
    id: 'grill-me',
    title: 'Grill Me',
    description: 'Menguji pemahaman user dengan pertanyaan balik dan tantangan berpikir kritis.',
    triggers: ['grill me', 'uji saya', 'tes saya', 'interview saya', 'tanya balik', 'latihan interview'],
    modelHint: 'chat',
    instructions: 'Jalankan sesi latihan bertahap: beri bahan bacaan singkat, minta kesiapan, lalu beri soal dan evaluasi.',
  },
];

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSkill(skillPath: string, fallbackId: string): WebSkill | null {
  const manifestPath = join(skillPath, 'skill.json');
  const instructionsPath = join(skillPath, 'SKILL.md');

  if (!existsSync(manifestPath) || !existsSync(instructionsPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<WebSkill>;
    const instructions = readFileSync(instructionsPath, 'utf8').trim();

    if (!manifest.id && !fallbackId) {
      return null;
    }

    return {
      id: manifest.id || fallbackId,
      title: manifest.title || manifest.id || fallbackId,
      description: manifest.description || '',
      triggers: Array.isArray(manifest.triggers) ? manifest.triggers : [],
      modelHint: manifest.modelHint,
      instructions,
    };
  } catch {
    return null;
  }
}

export function loadWebSkills() {
  if (!existsSync(skillsDir)) {
    return fallbackSkills;
  }

  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkill(join(skillsDir, entry.name), entry.name))
    .filter((skill): skill is WebSkill => Boolean(skill))
    .sort((a, b) => a.title.localeCompare(b.title));

  return skills.length ? skills : fallbackSkills;
}

export function getWebSkill(skillId: string) {
  return loadWebSkills().find((skill) => skill.id === skillId) || null;
}

export function selectWebSkill(message: string, requestedSkillId?: string, intentHint?: 'technical' | 'casual') {
  if (requestedSkillId) {
    const requested = getWebSkill(requestedSkillId);
    if (requested) {
      return requested;
    }
  }

  const normalizedMessage = normalize(message);
  const scored = loadWebSkills()
    .map((skill) => {
      const score = skill.triggers.reduce((total, trigger) => {
        const normalizedTrigger = normalize(trigger);
        if (!normalizedTrigger || !normalizedMessage.includes(normalizedTrigger)) {
          return total;
        }

        const weight = normalizedTrigger.split(' ').filter(Boolean).length;
        return total + Math.max(1, weight);
      }, 0);
      return { skill, score };
    })
    .sort((a, b) => b.score - a.score);

  const matched = scored.find((item) => item.score > 0)?.skill;
  if (matched) {
    return matched;
  }

  if (intentHint === 'technical') {
    return getWebSkill('technical-helper') || getWebSkill('general-chat') || scored[0]?.skill || null;
  }

  return getWebSkill('general-chat') || scored[0]?.skill || null;
}

export function saveWebSkill(skill: WebSkill) {
  const skillPath = join(skillsDir, skill.id);
  if (!existsSync(skillPath)) {
    mkdirSync(skillPath, { recursive: true });
  }

  const manifestPath = join(skillPath, 'skill.json');
  const instructionsPath = join(skillPath, 'SKILL.md');

  const manifest = {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    triggers: skill.triggers,
    modelHint: skill.modelHint,
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(instructionsPath, skill.instructions, 'utf8');
}

export function deleteWebSkill(skillId: string) {
  const skillPath = join(skillsDir, skillId);
  if (existsSync(skillPath)) {
    rmSync(skillPath, { recursive: true, force: true });
  }
}
