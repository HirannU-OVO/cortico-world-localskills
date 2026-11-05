/**
 * 技能库核心类型定义
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  whenToUse?: string;
  version?: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
}

export type SkillSourceType = 'market' | 'git' | 'local' | 'manual' | 'builtin' | 'external' | 'created';

export type SkillTriState = 'on' | 'manual' | 'off';

/** 单个技能的内部完整实体 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  version?: string;
  license?: string;
  allowedTools?: string[];
  dir: string;
  file: string;
  body: string;
  source: SkillSourceType;
  state: SkillTriState;
  userEdited?: boolean;
  /** 安装来源仓库（market 安装时写入），用于与市场条目核对是否同一个技能 */
  repo?: string;
  canonicalName?: string;
  installedContentHash?: string;
  installedAt?: string;
  lineCount: number;
  charCount: number;
  resources: string[];
  health: HealthIssue[];
}

/** 技能健康度与诊断告警 */
export interface HealthIssue {
  type: 'frontmatter-invalid' | 'missing-skill-md' | 'oversized' | 'name-conflict' | 'path-escape';
  message: string;
  level: 'warn' | 'error';
}

/** 技能目录内 `_skill_meta.json` 结构 */
export interface SkillMetaFile {
  schema: number;
  id: string;
  namespace?: string;
  canonicalName?: string;
  version?: string;
  source: SkillSourceType;
  installedAt?: string;
  updatedAt?: string | null;
  repo?: string;
  downloadUrl?: string;
  installedContentHash?: string;
  userEdited?: boolean;
  labels?: Record<string, string>;
  description_zh?: string;
  description_en?: string;
  icon?: string;
}

/** 全局 `state.json` 结构 */
export interface SkillsGlobalState {
  schema: number;
  updatedAt: string;
  disable: string[];
  disableModelInvocation: string[];
  sources: Array<{ id: string; url: string; name: string }>;
  scanSignature: {
    files: number;
    bytes: number;
    xor: number;
    savedAt?: string | null;
  };
  migrations?: Record<string, unknown>;
}

/** 市场条目的获取方式 */
export type MarketProviderKind = 'github' | 'static' | 'builtin';

/** 市场索引中的条目 */
export interface MarketIndexEntry {
  id: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  license?: string;
  tags?: string[];
  repo?: string;
  path?: string;
  downloadUrl: string;
  sha256?: string;
  bytes?: number;
  /**
   * 获取方式：
   * - github：按 GitHub 目录逐文件拉取（raw 地址没有 zip，需要走多文件下载）
   * - static：静态索引 JSON 指向的 zip 直链
   * - builtin：插件内置的离线预设
   */
  provider?: MarketProviderKind;
  /** provider=github 时的 raw 基地址，如 https://raw.githubusercontent.com/anthropics/skills/main/skills */
  rawBase?: string;
  /**
   * 远端内容指纹（github 源用文件树 sha 聚合；static 源可用 sha256）。
   * 官方技能普遍没有 version 字段，更新检测靠它而不是版本号。
   */
  contentHash?: string;
  summary?: {
    skillLines?: number;
    files?: number;
    loadChars?: number;
  };
  engineVersion?: string;
  updatedAt?: string;
}

export interface MarketIndexFile {
  $meta?: {
    schema?: number;
    name?: string;
    homepage?: string;
    updatedAt?: string;
  };
  [skillId: string]: unknown;
}
