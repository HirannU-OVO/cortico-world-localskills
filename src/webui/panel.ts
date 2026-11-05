/**
 * 技能库 WebUI 面板协议与后端 Invoke 调度
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillScanner } from '../core/scanner.ts';
import type { StateManager } from '../core/state.ts';
import { MarketManager } from '../market/index.ts';
import { installSkillPackage } from '../market/installer.ts';
import type { MarketIndexEntry, Skill, SkillTriState } from '../types.ts';

export interface PanelContext {
  scanner: SkillScanner;
  stateManager: StateManager;
  marketManager: MarketManager;
  companionDataDir: string;
  getInstallDir: () => string;
  getMarketIndexUrl: () => string;
  getMaxPackageMb: () => number;
  getMaxFiles: () => number;
  getDownloadTimeoutSec: () => number;
}

export class PanelDispatcher {
  private ctx: PanelContext;
  private isOperating = false;

  constructor(ctx: PanelContext) {
    this.ctx = ctx;
  }

  async invoke(panel: string, method: string, args: unknown): Promise<unknown> {
    if (panel === 'skills') {
      return this.handleSkills(method, args);
    }
    if (panel === 'market') {
      return this.handleMarket(method, args);
    }
    throw new Error(`未知的面板: ${panel}`);
  }

  private extractArg(args: unknown): Record<string, unknown> {
    if (Array.isArray(args)) {
      return (args[0] || {}) as Record<string, unknown>;
    }
    return (args || {}) as Record<string, unknown>;
  }

  private async handleSkills(method: string, args: unknown): Promise<unknown> {
    const p = this.extractArg(args);

    switch (method) {
      case 'list': {
        const query = typeof p.query === 'string' ? p.query.trim().toLowerCase() : '';
        const filter = typeof p.filter === 'string' ? p.filter : 'all'; // all, on, manual, off
        let skills = this.ctx.scanner.scan();

        if (filter !== 'all') {
          skills = skills.filter((s) => s.state === filter);
        }

        if (query) {
          skills = skills.filter(
            (s) =>
              s.id.includes(query) ||
              s.name.toLowerCase().includes(query) ||
              s.description.toLowerCase().includes(query)
          );
        }

        return skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          version: s.version || '1.0.0',
          source: s.source,
          state: s.state,
          lineCount: s.lineCount,
          charCount: s.charCount,
          health: s.health,
          userEdited: s.userEdited,
          dir: s.dir,
        }));
      }

      case 'detail': {
        const id = String(p.id || '').toLowerCase();
        const skill = this.ctx.scanner.scan().find((s) => s.id === id);
        if (!skill) throw new Error(`未找到技能: ${id}`);
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          whenToUse: skill.whenToUse,
          version: skill.version,
          license: skill.license,
          allowedTools: skill.allowedTools,
          state: skill.state,
          source: skill.source,
          body: skill.body,
          resources: skill.resources,
          health: skill.health,
          dir: skill.dir,
          userEdited: skill.userEdited,
          installedAt: skill.installedAt,
        };
      }

      case 'toggle': {
        const id = String(p.id || '').toLowerCase();
        const state = p.state as SkillTriState;
        if (!['on', 'manual', 'off'].includes(state)) {
          throw new Error(`无效的状态模式: ${state}`);
        }
        this.ctx.stateManager.setSkillState(id, state);
        return { ok: true, state };
      }

      case 'remove': {
        if (this.isOperating) throw new Error('另一个操作正在进行中，请稍候');
        this.isOperating = true;
        try {
          const id = String(p.id || '').toLowerCase();
          const skill = this.ctx.scanner.scan().find((s) => s.id === id);
          if (!skill) throw new Error(`未找到技能: ${id}`);

          if (skill.source === 'external') {
            throw new Error('外部客户端安装的技能禁止在桌宠中删除，请至原宿主管理');
          }

          const trashDir = join(this.ctx.companionDataDir, 'localskills', 'trash');
          mkdirSync(trashDir, { recursive: true });
          const targetTrash = join(trashDir, `${id}-${Date.now()}`);

          renameSync(skill.dir, targetTrash);
          this.ctx.scanner.invalidate();
          return { ok: true, trashedPath: targetTrash };
        } finally {
          this.isOperating = false;
        }
      }

      case 'reload': {
        this.ctx.scanner.invalidate();
        const count = this.ctx.scanner.scan(true).length;
        return count;
      }

      case 'state': {
        const all = this.ctx.scanner.scan();
        return {
          total: all.length,
          enabled: all.filter((s) => s.state === 'on').length,
          manual: all.filter((s) => s.state === 'manual').length,
          off: all.filter((s) => s.state === 'off').length,
        };
      }

      default:
        throw new Error(`skills 面板不支持的方法: ${method}`);
    }
  }

  private async handleMarket(method: string, args: unknown): Promise<unknown> {
    const p = this.extractArg(args);

    switch (method) {
      case 'search': {
        const query = typeof p.query === 'string' ? p.query : '';
        const tag = typeof p.tag === 'string' ? p.tag : '';
        const indexUrl = this.ctx.getMarketIndexUrl();
        const { items, fromCache, error } = await this.ctx.marketManager.fetchIndex(indexUrl);
        const filtered = this.ctx.marketManager.search(items, query, tag);

        // 结合本地安装情况比对状态与更新
        const localSkills = this.ctx.scanner.scan();
        const enriched = filtered.map((entry) => {
          const local = localSkills.find((s) => s.id === entry.id);

          // 只有「市场安装 + 同一来源仓库」才算同一个技能。
          // 本地同名的手写/外部技能不能被当成已安装，更不能被更新覆盖。
          const sameOrigin = Boolean(
            local &&
              local.source === 'market' &&
              (!entry.repo || !local.repo || local.repo.toLowerCase() === entry.repo.toLowerCase())
          );
          const conflict = Boolean(local && !sameOrigin);

          // 优先比内容指纹：官方技能普遍没有 version，版本号比对永远相等
          const remoteHash = entry.contentHash || entry.sha256;
          const localHash = local?.installedContentHash;
          const hasUpdate = Boolean(
            sameOrigin &&
              (remoteHash && localHash
                ? remoteHash !== localHash
                : local.version && entry.version && local.version !== entry.version)
          );

          return {
            ...entry,
            installed: sameOrigin,
            conflict,
            localVersion: sameOrigin ? local?.version : undefined,
            hasUpdate,
          };
        });

        return { items: enriched, total: enriched.length, fromCache, error };
      }

      case 'install':
      case 'update': {
        if (this.isOperating) throw new Error('已有安装/更新任务正在进行中');
        this.isOperating = true;
        try {
          const id = String(p.id || '').toLowerCase();
          const indexUrl = this.ctx.getMarketIndexUrl();
          const { items } = await this.ctx.marketManager.fetchIndex(indexUrl);
          const entry = items.find((e) => e.id === id);
          if (!entry) throw new Error(`技能市场索引中未找到该技能: ${id}`);

          const res = await installSkillPackage({
            entry,
            installDir: this.ctx.getInstallDir(),
            dataDir: this.ctx.companionDataDir,
            stateManager: this.ctx.stateManager,
            maxPackageMb: this.ctx.getMaxPackageMb(),
            maxFiles: this.ctx.getMaxFiles(),
            downloadTimeoutSec: this.ctx.getDownloadTimeoutSec(),
          });

          if (res.ok) {
            this.ctx.scanner.invalidate();
          }
          return res;
        } finally {
          this.isOperating = false;
        }
      }

      case 'refresh': {
        const indexUrl = this.ctx.getMarketIndexUrl();
        const res = await this.ctx.marketManager.fetchIndex(indexUrl, true);
        return { ok: true, count: res.items.length, error: res.error };
      }

      default:
        throw new Error(`market 面板不支持的方法: ${method}`);
    }
  }
}
