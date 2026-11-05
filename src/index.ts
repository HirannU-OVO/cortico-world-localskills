/**
 * 技能库 WorldDefinition 装配入口
 * 支持本地技能扫描、三态启停、分段读取、市场管理与 WebUI 面板调度
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext, WorldDefinition } from 'cortico/world.ts';

import { SKILLS_DEFAULTS, SKILLS_ID, skillsConfigGroups, type SkillsConfig } from './config.ts';
import { SkillScanner } from './core/scanner.ts';
import { StateManager } from './core/state.ts';
import { MarketManager } from './market/index.ts';
import { buildSkillTools } from './tools.ts';
import { PanelDispatcher } from './webui/panel.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./prompt/ENV_PROMPT.md', import.meta.url));

export class SkillsWorld implements World {
  readonly id = SKILLS_ID;
  private readonly ctx: WorldContext<SkillsConfig>;
  private readonly companionDataDir: string;
  private readonly dataRoot: string;
  private host: WorldHost | null = null;

  private stateManager: StateManager;
  private scanner: SkillScanner;
  private marketManager: MarketManager;
  private panelDispatcher: PanelDispatcher;

  constructor(ctx: WorldContext<SkillsConfig>) {
    this.ctx = ctx;
    this.companionDataDir = ctx.dataDir;
    this.dataRoot = resolve(ctx.dataDir, '..');

    this.stateManager = new StateManager(this.companionDataDir);

    const baseDir = this.resolveBaseDir();
    const dirs = this.ctx.cfg.dirs || 'skills';
    this.scanner = new SkillScanner({
      baseDir,
      dirs,
      stateManager: this.stateManager,
    });

    this.marketManager = new MarketManager({
      dataDir: this.companionDataDir,
      cacheMinutes: this.ctx.cfg.marketCacheMinutes || 60,
    });

    this.panelDispatcher = new PanelDispatcher({
      scanner: this.scanner,
      stateManager: this.stateManager,
      marketManager: this.marketManager,
      companionDataDir: this.companionDataDir,
      getInstallDir: () => resolve(this.resolveBaseDir(), this.ctx.cfg.installDir || 'skills'),
      getMarketIndexUrl: () => (this.ctx.cfg.marketIndexUrl || '').trim(),
      getMaxPackageMb: () => this.ctx.cfg.maxPackageMb || 20,
      getMaxFiles: () => this.ctx.cfg.maxFiles || 200,
      getDownloadTimeoutSec: () => this.ctx.cfg.downloadTimeoutSec || 60,
    });
  }

  private resolveBaseDir(): string {
    const custom = (this.ctx.cfg.baseDir ?? '').trim();
    if (custom) return resolve(custom);
    return this.dataRoot;
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.scanner.updateConfig(this.resolveBaseDir(), this.ctx.cfg.dirs || 'skills');
    const skills = this.scanner.scan();
    const enabledCount = skills.filter((s) => s.state === 'on').length;
    const manualCount = skills.filter((s) => s.state === 'manual').length;
    host.log.info(
      `[skills] 技能库已就绪：共 ${skills.length} 个（启用 ${enabledCount}，仅手动 ${manualCount}，根目录 ${this.resolveBaseDir()}）`
    );
  }

  async stop(): Promise<void> {
    this.host = null;
  }

  envPromptVars(): Record<string, string> | null {
    if (this.ctx.cfg.promptEnabled === false) return null;
    this.scanner.updateConfig(this.resolveBaseDir(), this.ctx.cfg.dirs || 'skills');
    // 注入列表排除已停用 (off) 状态的技能
    const skills = this.scanner.scan().filter((s) => s.state !== 'off');
    if (!skills.length) return null;

    const descLimit = this.ctx.cfg.promptDescChars || 70;
    const list = skills
      .map((s) => {
        const manualTag = s.state === 'manual' ? '（仅手动）' : '';
        const desc = s.description.replace(/\s+/g, ' ').slice(0, descLimit);
        return `- ${s.name}${manualTag}：${desc}`;
      })
      .join('\n');

    return {
      skillCount: String(skills.length),
      skillDirs: this.scanner.getRoots().join('；'),
      skillList: list,
    };
  }

  tools(): ToolDef[] {
    return buildSkillTools({
      scanner: this.scanner,
      getMaxChars: () => Math.max(500, this.ctx.cfg.maxLoadChars || 12000),
      getAllowModelWrite: () => Boolean(this.ctx.cfg.allowModelWrite),
      getInstallRoot: () => resolve(this.resolveBaseDir(), this.ctx.cfg.installDir || 'skills'),
      onInstall: async (id) => (await this.panelDispatcher.invoke('market', 'install', { id })) as any,
      onUninstall: async (id) => (await this.panelDispatcher.invoke('skills', 'remove', { id })) as any,
      onUpdate: async (id) => (await this.panelDispatcher.invoke('market', 'update', { id })) as any,
    });
  }

  webUi() {
    this.scanner.updateConfig(this.resolveBaseDir(), this.ctx.cfg.dirs || 'skills');
    const all = this.scanner.scan();
    const enabled = all.filter((s) => s.state === 'on').length;

    return {
      badges: [{ label: '技能', value: `${enabled}/${all.length}`, tone: 'on' as const }],
      panels: [
        { id: 'skills', title: '我的技能', getMethods: ['list', 'detail', 'state'] },
        { id: 'market', title: '技能市场', getMethods: ['search'] },
      ],
      invoke: (panel: string, method: string, args?: unknown) => this.panelDispatcher.invoke(panel, method, args),
      config: skillsConfigGroups(this.resolveBaseDir()),
      promptDocs: [
        {
          key: 'worlds.skills.envPrompt',
          title: '技能库 · 环境提示词',
          description: '注入到系统前缀中：可用技能索引与规范要求。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt' as const,
          vars: [
            { name: 'skillCount', description: '可用技能总数' },
            { name: 'skillDirs', description: '扫描的技能根路径' },
            { name: 'skillList', description: '技能名、状态与摘要' },
          ],
        },
      ],
    };
  }
}

export const SKILLS_WORLD: WorldDefinition<SkillsConfig> = {
  id: SKILLS_ID,
  label: '技能库',
  defaults: SKILLS_DEFAULTS,
  create: (ctx) => new SkillsWorld(ctx),
  describe: {
    tools: [
      {
        name: 'skill_list',
        description: '列出本机技能库里已启用的专属技能清单。',
        parameters: {
          type: 'object',
          properties: {
            includeManual: { type: 'boolean', description: '是否包含仅手动调用的技能' },
          },
        },
        tags: ['read'],
        summary: { zh: '列出本机技能库。', en: 'List local skills.' },
      },
      {
        name: 'skill_load',
        description: '读取某个技能的完整说明，支持分段续读。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名或 ID' },
            offset: { type: 'number', description: '起始字符偏移量' },
            limit: { type: 'number', description: '单次读取上限' },
          },
          required: ['name'],
        },
        tags: ['read'],
        summary: { zh: '读取技能完整正文。', en: 'Load a skill body.' },
      },
      {
        name: 'skill_read',
        description: '读取技能目录里的参考或脚本资源文件。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名或 ID' },
            path: { type: 'string', description: '相对路径' },
          },
          required: ['name', 'path'],
        },
        tags: ['read'],
        summary: { zh: '读取技能附带资源。', en: 'Read a resource inside a skill.' },
      },
      {
        name: 'skill_search',
        description: '全文搜索本地技能。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            limit: { type: 'number', description: '最大结果数' },
          },
          required: ['query'],
        },
        tags: ['read'],
        summary: { zh: '全文搜索技能。', en: 'Search local skills.' },
      },
      {
        name: 'skill_create',
        description: '在本机技能库里新建一个技能（写 SKILL.md 与元数据）。当现有技能都不适用、而这套做法以后还会重复用时使用；一次性的临时操作不要建技能。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名，同时作为目录名：小写字母/数字/点/下划线/连字符，≤64' },
            description: { type: 'string', description: '一句话说明：这个技能做什么、什么时候该用' },
            body: { type: 'string', description: 'SKILL.md 正文（Markdown），按步骤写清做法与坑' },
            whenToUse: { type: 'string', description: '可选：更具体的触发场景' },
            allowedTools: { type: 'array', items: { type: 'string' }, description: '可选：需要的工具' },
          },
          required: ['name', 'description', 'body'],
        },
        tags: ['write'],
        summary: { zh: '新建一个技能。', en: 'Create a new skill.' },
      },
      {
        name: 'skill_install',
        description: '从技能市场安装指定技能。仅在 allowModelWrite 开启时可用。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: '市场中的技能 ID' } },
          required: ['id'],
        },
        tags: ['write'],
        summary: { zh: '从市场安装技能。', en: 'Install a skill.' },
      },
      {
        name: 'skill_uninstall',
        description: '卸载指定技能并移入回收站。仅在 allowModelWrite 开启时可用。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: '技能 ID' } },
          required: ['id'],
        },
        tags: ['write'],
        summary: { zh: '卸载技能到回收站。', en: 'Uninstall a skill.' },
      },
      {
        name: 'skill_update',
        description: '把市场安装的技能更新到最新版本。仅在 allowModelWrite 开启时可用。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: '技能 ID' } },
          required: ['id'],
        },
        tags: ['write'],
        summary: { zh: '更新市场技能。', en: 'Update a skill.' },
      },
    ],
    events: [],
  },
};

export const id = SKILLS_WORLD.id;
export const label = SKILLS_WORLD.label;
export const defaults = SKILLS_WORLD.defaults;
export const create = SKILLS_WORLD.create;
export default SKILLS_WORLD;
