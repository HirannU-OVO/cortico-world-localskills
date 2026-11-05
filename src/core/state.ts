/**
 * 全局状态与安装记录管理
 * 存储路径：<companion>/data/localskills/state.json
 * 支持原子写入，断电/并发安全
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillMetaFile, SkillsGlobalState, SkillTriState } from '../types.ts';

const STATE_FILE_NAME = 'state.json';
const CURRENT_SCHEMA = 2;

export class StateManager {
  private readonly stateFile: string;
  private readonly stateDir: string;
  private cache: SkillsGlobalState | null = null;

  constructor(companionDataDir: string) {
    this.stateDir = join(companionDataDir, 'localskills');
    this.stateFile = join(this.stateDir, STATE_FILE_NAME);
  }

  getDir(): string {
    return this.stateDir;
  }

  load(): SkillsGlobalState {
    if (this.cache) return this.cache;
    if (existsSync(this.stateFile)) {
      try {
        const raw = readFileSync(this.stateFile, 'utf8');
        const parsed = JSON.parse(raw) as SkillsGlobalState;
        if (parsed && typeof parsed === 'object') {
          this.cache = {
            schema: parsed.schema ?? CURRENT_SCHEMA,
            updatedAt: parsed.updatedAt ?? new Date().toISOString(),
            disable: Array.isArray(parsed.disable) ? parsed.disable.map((s) => String(s).toLowerCase()) : [],
            disableModelInvocation: Array.isArray(parsed.disableModelInvocation)
              ? parsed.disableModelInvocation.map((s) => String(s).toLowerCase())
              : [],
            sources: Array.isArray(parsed.sources) ? parsed.sources : [],
            scanSignature: parsed.scanSignature ?? { files: 0, bytes: 0, xor: 0, savedAt: null },
            migrations: parsed.migrations ?? {},
          };
          return this.cache;
        }
      } catch {
        // 解析失败时降级回默认状态
      }
    }

    const defaultState: SkillsGlobalState = {
      schema: CURRENT_SCHEMA,
      updatedAt: new Date().toISOString(),
      disable: [],
      disableModelInvocation: [],
      sources: [],
      scanSignature: { files: 0, bytes: 0, xor: 0, savedAt: null },
      migrations: {},
    };
    this.cache = defaultState;
    return defaultState;
  }

  save(nextState: Partial<SkillsGlobalState>): void {
    const current = this.load();
    const updated: SkillsGlobalState = {
      ...current,
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
    this.cache = updated;

    mkdirSync(this.stateDir, { recursive: true });
    const tmp = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(updated, null, 2), 'utf8');
    renameSync(tmp, this.stateFile);
  }

  getSkillState(id: string): SkillTriState {
    const state = this.load();
    const key = id.toLowerCase();
    if (state.disable.includes(key)) return 'off';
    if (state.disableModelInvocation.includes(key)) return 'manual';
    return 'on';
  }

  setSkillState(id: string, triState: SkillTriState): void {
    const state = this.load();
    const key = id.toLowerCase();
    const disableSet = new Set(state.disable);
    const manualSet = new Set(state.disableModelInvocation);

    disableSet.delete(key);
    manualSet.delete(key);

    if (triState === 'off') {
      disableSet.add(key);
    } else if (triState === 'manual') {
      manualSet.add(key);
    }

    this.save({
      disable: Array.from(disableSet),
      disableModelInvocation: Array.from(manualSet),
    });
  }

  readSkillMeta(skillDir: string): SkillMetaFile | null {
    const metaPath = join(skillDir, '_skill_meta.json');
    if (!existsSync(metaPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as SkillMetaFile;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  writeSkillMeta(skillDir: string, meta: Partial<SkillMetaFile>): void {
    const metaPath = join(skillDir, '_skill_meta.json');
    const existing = this.readSkillMeta(skillDir) || {
      schema: 1,
      id: '',
      source: 'manual',
      installedAt: new Date().toISOString(),
    };
    const full = { ...existing, ...meta };
    const tmp = `${metaPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(full, null, 2), 'utf8');
    renameSync(tmp, metaPath);
  }
}
