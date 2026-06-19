import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
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
mkdirSync(skillsDir, { recursive: true });

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
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkill(join(skillsDir, entry.name), entry.name))
    .filter((skill): skill is WebSkill => Boolean(skill))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getWebSkill(skillId: string) {
  return loadWebSkills().find((skill) => skill.id === skillId) || null;
}

export function selectWebSkill(message: string, requestedSkillId?: string) {
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
        return total + (normalizedTrigger && normalizedMessage.includes(normalizedTrigger) ? 1 : 0);
      }, 0);
      return { skill, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.find((item) => item.score > 0)?.skill || getWebSkill('general-chat') || scored[0]?.skill || null;
}
