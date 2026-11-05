/**
 * 技能目录扫描器
 * 基于目录树指纹 (files, bytes, xor) 实现高速精准缓存，替代固定秒数定时重扫。
 * 支持多种技能元数据（自带 _skill_meta.json、外部 __skillhub 后缀、无元数据 manual 兼容）。
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { HealthIssue, Skill, SkillSourceType } from '../types.ts';
import { fallbackDescription, parseFrontmatter, safeSkillName } from './frontmatter.ts';
import { checkSkillHealth } from './health.ts';
import type { StateManager } from './state.ts';

const SKILL_FILES = ['SKILL.md', 'skill.md'];

export interface ScanSignature {
  files: number;
  bytes: number;
  xor: number;
}

export interface ScannerOptions {
  baseDir: string;
  dirs: string;
  stateManager: StateManager;
}

export function isAbsolutePath(p: string): boolean {
  return isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

export function resolveSkillDirs(baseDir: string, dirsConfig: string | undefined): string[] {
  const raw = (dirsConfig || 'skills')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const item of raw) {
    const abs = isAbsolutePath(item) ? resolve(item) : resolve(baseDir, item);
    const key = abs.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(abs);
    }
  }
  return resolved;
}

function findSkillFile(dir: string): string | null {
  for (const name of SKILL_FILES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // ignore
      }
    }
  }
  // 大小写不敏感容错
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKILL_FILES.includes(entry)) {
        const candidate = join(dir, entry);
        if (statSync(candidate).isFile()) return candidate;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function listSkillResources(skillDir: string): string[] {
  const result: string[] = [];
  try {
    const walk = (current: string, prefix: string) => {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const subRel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(join(current, entry.name), subRel);
        } else if (entry.isFile()) {
          if (!SKILL_FILES.includes(entry.name) && entry.name !== '_skill_meta.json') {
            result.push(subRel);
          }
        }
      }
    };
    walk(skillDir, '');
  } catch {
    // ignore
  }
  return result;
}

/** 计算技能目录树指纹 */
export function computeScanSignature(roots: string[]): ScanSignature {
  let files = 0;
  let bytes = 0;
  let xor = 0;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const subdirs = readdirSync(root, { withFileTypes: true });
      for (const sub of subdirs) {
        if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
        const skillDir = join(root, sub.name);
        const skillFile = findSkillFile(skillDir);
        if (skillFile) {
          try {
            const st = statSync(skillFile);
            files += 1;
            bytes += st.size;
            xor = (xor ^ (st.size + Math.trunc(st.mtimeMs))) >>> 0;
          } catch {
            // ignore
          }
        }
        const metaFile = join(skillDir, '_skill_meta.json');
        if (existsSync(metaFile)) {
          try {
            const st = statSync(metaFile);
            files += 1;
            bytes += st.size;
            xor = (xor ^ (st.size + Math.trunc(st.mtimeMs))) >>> 0;
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return { files, bytes, xor };
}

export class SkillScanner {
  private baseDir: string;
  private dirs: string;
  private stateManager: StateManager;
  private cachedSkills: Skill[] = [];
  private cachedSignature: ScanSignature = { files: 0, bytes: 0, xor: 0 };

  constructor(opts: ScannerOptions) {
    this.baseDir = opts.baseDir;
    this.dirs = opts.dirs;
    this.stateManager = opts.stateManager;
  }

  updateConfig(baseDir: string, dirs: string): void {
    this.baseDir = baseDir;
    this.dirs = dirs;
  }

  getRoots(): string[] {
    return resolveSkillDirs(this.baseDir, this.dirs);
  }

  invalidate(): void {
    this.cachedSignature = { files: 0, bytes: 0, xor: 0 };
  }

  scan(force = false): Skill[] {
    const roots = this.getRoots();
    const sig = computeScanSignature(roots);

    if (
      !force &&
      this.cachedSkills.length > 0 &&
      sig.files === this.cachedSignature.files &&
      sig.bytes === this.cachedSignature.bytes &&
      sig.xor === this.cachedSignature.xor
    ) {
      // 指纹一致，但仍需结合 state 的三态更新每个 skill 的 state 属性
      return this.cachedSkills.map((s) => ({
        ...s,
        state: this.stateManager.getSkillState(s.id),
      }));
    }

    const skills: Skill[] = [];
    const seenIds = new Set<string>();

    for (const root of roots) {
      if (!existsSync(root)) continue;
      let entries: string[] = [];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const skillDir = join(root, entry);
        let st;
        try {
          st = statSync(skillDir);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;

        const skillFile = findSkillFile(skillDir);
        const healthIssues: HealthIssue[] = [];

        if (!skillFile) {
          continue;
        }

        let content = '';
        try {
          content = readFileSync(skillFile, 'utf8');
        } catch {
          continue;
        }

        const { data: fm, body, valid } = parseFrontmatter(content);
        if (!valid) {
          healthIssues.push({
            type: 'frontmatter-invalid',
            message: 'SKILL.md 缺少或损坏了 Frontmatter 标头',
            level: 'warn',
          });
        }

        // 解析来源与元数据
        let source: SkillSourceType = 'manual';
        const meta = this.stateManager.readSkillMeta(skillDir);

        if (meta?.source) {
          source = meta.source;
        } else if (entry.endsWith('__skillhub')) {
          source = 'external';
        } else if (existsSync(join(skillDir, '.eac-skill.json'))) {
          source = 'builtin';
        }

        const fallbackName = entry.replace(/__skillhub$/, '');
        const id = safeSkillName(fm.name || fallbackName, fallbackName).toLowerCase();
        const displayName = fm.name || fallbackName;
        const description = fm.description || fallbackDescription(body);
        const whenToUse = fm.whenToUse || '';
        const lines = content.split(/\r?\n/).length;
        const charCount = content.length;
        const resources = listSkillResources(skillDir);

        let realDir = skillDir;
        try {
          realDir = realpathSync(skillDir);
        } catch {
          // ignore
        }

        const skill: Skill = {
          id,
          name: displayName,
          description,
          whenToUse,
          version: fm.version || meta?.version,
          license: fm.license,
          allowedTools: fm.allowedTools,
          dir: realDir,
          file: skillFile,
          body,
          source,
          state: this.stateManager.getSkillState(id),
          userEdited: meta?.userEdited,
          repo: meta?.repo,
          canonicalName: meta?.canonicalName,
          installedContentHash: meta?.installedContentHash,
          installedAt: meta?.installedAt,
          lineCount: lines,
          charCount,
          resources,
          health: healthIssues,
        };

        skills.push(skill);
      }
    }

    // 二次健康检查（重名、体积等）
    const finalized = skills.map((s) => ({
      ...s,
      health: checkSkillHealth(s, skills),
    }));

    this.cachedSkills = finalized;
    this.cachedSignature = sig;
    return finalized;
  }
}
