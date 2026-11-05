/**
 * 技能库配置与默认值
 */
import type { ConfigGroup } from 'cortico/core/types.ts';

export const SKILLS_ID = 'skills';
export const DEFAULT_SKILL_DIR = 'skills';
export const DEFAULT_MAX_CHARS = 12000;
export const DEFAULT_PROMPT_DESC_CHARS = 70;
export const DEFAULT_MARKET_CACHE_MINUTES = 60;
export const DEFAULT_MAX_PACKAGE_MB = 20;
export const DEFAULT_MAX_FILES = 200;
export const DEFAULT_DOWNLOAD_TIMEOUT_SEC = 60;

/**
 * 默认技能源：Anthropic 官方 Agent Skills 仓库（19 个标准 SKILL.md，公开免认证）。
 * 走 GitHub Contents API 列目录，安装时按 raw 逐文件拉取。
 * 注意未认证限流 60 次/小时，索引有 60 分钟缓存，正常使用远低于上限。
 */
export const DEFAULT_MARKET_SOURCE = 'https://api.github.com/repos/anthropics/skills/contents/skills';

export interface SkillsConfig {
  enabled: boolean;

  // —— 扫描 ——
  dirs?: string;
  baseDir?: string;
  promptEnabled?: boolean;
  maxLoadChars?: number;
  promptDescChars?: number;

  // —— 市场 ——
  marketEnabled?: boolean;
  marketIndexUrl?: string;
  marketCacheMinutes?: number;
  customSources?: string;

  // —— 安装 ——
  installDir?: string;
  maxPackageMb?: number;
  maxFiles?: number;
  downloadTimeoutSec?: number;
  allowPrerelease?: boolean;

  // —— 行为 ——
  disabledIds?: string[];
  autoCheckUpdate?: boolean;
  allowModelWrite?: boolean;
}

export const SKILLS_DEFAULTS = (): SkillsConfig => ({
  enabled: false,
  dirs: DEFAULT_SKILL_DIR,
  baseDir: '',
  promptEnabled: true,
  maxLoadChars: DEFAULT_MAX_CHARS,
  promptDescChars: DEFAULT_PROMPT_DESC_CHARS,

  marketEnabled: true,
  marketIndexUrl: DEFAULT_MARKET_SOURCE,
  marketCacheMinutes: DEFAULT_MARKET_CACHE_MINUTES,
  customSources: '',

  installDir: DEFAULT_SKILL_DIR,
  maxPackageMb: DEFAULT_MAX_PACKAGE_MB,
  maxFiles: DEFAULT_MAX_FILES,
  downloadTimeoutSec: DEFAULT_DOWNLOAD_TIMEOUT_SEC,
  allowPrerelease: false,

  disabledIds: [],
  autoCheckUpdate: false,
  allowModelWrite: false,
});

export function skillsConfigGroups(recommendedBaseDir: string): ConfigGroup[] {
  return [
    {
      id: 'world:skills',
      owner: 'world:skills',
      schema: {
        type: 'object',
        title: '技能库 (Local Skills)',
        description: '按 Claude Skill 格式管理专属技能目录（SKILL.md）。支持只读发现、分段加载、三态启停与安全市场安装。',
        properties: {
          'worlds.skills.dirs': {
            type: 'string',
            title: '技能目录',
            description: '多个目录用分号分隔；相对路径按「技能库根目录」解析。默认 skills。',
            'x-hot': true,
          },
          'worlds.skills.baseDir': {
            type: 'string',
            title: '技能库根目录',
            description: '相对路径基准。留空 = 部署根目录（<companion>）。',
            'x-hot': true,
            'x-path': { kind: 'directory' as const, recommendedDir: recommendedBaseDir },
          },
          'worlds.skills.installDir': {
            type: 'string',
            title: '新技能安装目录',
            description: '市场安装新技能的落盘目录，相对技能库根目录，默认 skills。',
            'x-hot': true,
          },
          'worlds.skills.promptEnabled': {
            type: 'boolean',
            title: '注入技能清单到系统前缀',
            description: '开启后系统提示词中自动包含可用技能索引，供大模型按需加载。',
            'x-hot': true,
          },
          'worlds.skills.maxLoadChars': {
            type: 'number',
            title: '单次读取上限(字符)',
            description: 'skill_load / skill_read 返回内容的单次上限，默认 12000。超长可通过 offset 续读。',
            minimum: 2000,
            maximum: 60000,
            multipleOf: 500,
            'x-hot': true,
          },
          'worlds.skills.marketEnabled': {
            type: 'boolean',
            title: '启用技能市场',
            description: '关闭后不拉取网络索引。已安装技能照常可用。',
            'x-hot': true,
          },
          'worlds.skills.marketIndexUrl': {
            type: 'string',
            title: '外部市场索引地址',
            description:
              '默认 Anthropic 官方技能库（19 个标准技能，GitHub Contents API）。也可填静态索引 URL（$meta + map）或 owner/repo。留空则只用内置预置库。',
            'x-hot': true,
          },
          'worlds.skills.allowModelWrite': {
            type: 'boolean',
            title: '允许模型调用安装/卸载',
            description: '默认关闭。关闭时模型只有只读工具，只有用户可在设置面板中执行装卸。',
            'x-warning': true,
          },
        },
      },
    },
  ];
}
