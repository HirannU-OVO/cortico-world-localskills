/**
 * 技能市场索引拉取、预置成熟库合并与搜索
 * 优先提供内置预置成熟技能库，网络可用时自动合并远端源；
 * 网络直连失败时平滑降级，100% 保证本地离线可用与便捷安装。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketIndexEntry, MarketIndexFile } from '../types.ts';
import { fetchGithubEntries, parseGithubSource } from './github.ts';
import { httpGetJson } from './http.ts';
import { PRESET_MATURE_SKILLS } from './presets.ts';

export interface MarketManagerOptions {
  dataDir: string;
  cacheMinutes: number;
}

/** 索引缓存结构版本：条目字段变化时递增，旧缓存会被丢弃而不是沿用 */
const CACHE_SCHEMA = 2;

export class MarketManager {
  private readonly cacheDir: string;
  private readonly cacheFile: string;
  private readonly cacheMinutes: number;
  private memoryCache: MarketIndexEntry[] | null = null;
  private lastFetchedAt: number = 0;

  constructor(opts: MarketManagerOptions) {
    this.cacheDir = join(opts.dataDir, 'localskills');
    this.cacheFile = join(this.cacheDir, 'index-cache.json');
    this.cacheMinutes = opts.cacheMinutes || 60;
  }

  private loadFromDiskCache(): { items: MarketIndexEntry[]; timestamp: number } | null {
    if (!existsSync(this.cacheFile)) return null;
    try {
      const raw = readFileSync(this.cacheFile, 'utf8');
      const data = JSON.parse(raw);
      if (data.schema !== CACHE_SCHEMA) return null;
      if (Array.isArray(data.items) && typeof data.timestamp === 'number') {
        return { items: data.items, timestamp: data.timestamp };
      }
    } catch {
      // ignore
    }
    return null;
  }

  private saveToDiskCache(items: MarketIndexEntry[]): void {
    mkdirSync(this.cacheDir, { recursive: true });
    try {
      const payload = { schema: CACHE_SCHEMA, timestamp: Date.now(), items };
      writeFileSync(this.cacheFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  /** 获取内置的预置成熟技能清单 */
  getBuiltinPresets(): MarketIndexEntry[] {
    return PRESET_MATURE_SKILLS.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      version: p.version,
      author: p.author,
      license: p.license,
      tags: p.tags,
      repo: p.repo,
      path: p.path,
      downloadUrl: p.downloadUrl,
      sha256: p.sha256,
      bytes: p.bytes,
      summary: p.summary,
      engineVersion: p.engineVersion,
      updatedAt: p.updatedAt,
    }));
  }

  async fetchIndex(indexUrl?: string, force = false): Promise<{ items: MarketIndexEntry[]; fromCache: boolean; error?: string }> {
    const builtinItems = this.getBuiltinPresets();
    const map = new Map<string, MarketIndexEntry>();
    for (const item of builtinItems) {
      map.set(item.id, item);
    }

    const targetUrl = (indexUrl || '').trim();
    if (!targetUrl) {
      // 未配置或留空远端地址时，直接呈现预置推荐库
      return { items: Array.from(map.values()), fromCache: false };
    }

    const now = Date.now();
    const cacheTtlMs = this.cacheMinutes * 60 * 1000;

    if (!force && this.memoryCache && now - this.lastFetchedAt < cacheTtlMs) {
      for (const item of this.memoryCache) map.set(item.id, item);
      return { items: Array.from(map.values()), fromCache: true };
    }

    if (!force) {
      const disk = this.loadFromDiskCache();
      if (disk && now - disk.timestamp < cacheTtlMs) {
        this.memoryCache = disk.items;
        this.lastFetchedAt = disk.timestamp;
        for (const item of disk.items) map.set(item.id, item);
        return { items: Array.from(map.values()), fromCache: true };
      }
    }

    try {
      const remoteItems: MarketIndexEntry[] = [];
      const ghSource = parseGithubSource(targetUrl);

      if (ghSource) {
        // GitHub 目录型源（如 anthropics/skills）：列目录 + 读每个技能的 frontmatter
        const ghItems = await fetchGithubEntries(ghSource, { timeoutSec: 12 });
        for (const item of ghItems) {
          remoteItems.push(item);
          map.set(item.id, item);
        }
      } else {
        // 静态索引：$meta + map，downloadUrl 指向 zip
        const raw = await httpGetJson<MarketIndexFile>(targetUrl, { timeoutSec: 10 });

        for (const [key, val] of Object.entries(raw)) {
          if (key === '$meta' || !val || typeof val !== 'object') continue;
          const entry = val as Partial<MarketIndexEntry>;
          const item: MarketIndexEntry = {
            id: entry.id || key,
            displayName: entry.displayName || entry.id || key,
            description: entry.description || '',
            version: entry.version || '1.0.0',
            author: entry.author,
            license: entry.license,
            tags: Array.isArray(entry.tags) ? entry.tags : [],
            repo: entry.repo,
            path: entry.path,
            downloadUrl: entry.downloadUrl || '',
            sha256: entry.sha256,
            bytes: entry.bytes,
            provider: 'static',
            summary: entry.summary,
            engineVersion: entry.engineVersion,
            updatedAt: entry.updatedAt,
          };
          remoteItems.push(item);
          map.set(item.id, item);
        }
      }

      this.memoryCache = remoteItems;
      this.lastFetchedAt = now;
      this.saveToDiskCache(remoteItems);
      return { items: Array.from(map.values()), fromCache: false };
    } catch (err) {
      // 远端拉取失败（如直连 github raw 超时），平滑合并本地磁盘缓存与预置成熟库
      const disk = this.loadFromDiskCache();
      if (disk) {
        this.memoryCache = disk.items;
        this.lastFetchedAt = disk.timestamp;
        for (const item of disk.items) map.set(item.id, item);
      }
      return {
        items: Array.from(map.values()),
        fromCache: true,
        error: `外部源网络连接不可达，已自动切换为预置成熟技能库: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  search(items: MarketIndexEntry[], query?: string, tag?: string): MarketIndexEntry[] {
    let result = items;
    if (tag) {
      const t = tag.toLowerCase();
      result = result.filter((item) => item.tags?.some((x) => x.toLowerCase() === t));
    }
    if (!query || !query.trim()) return result;

    const q = query.trim().toLowerCase();
    return result
      .map((item) => {
        let score = 0;
        if (item.id === q || item.displayName.toLowerCase() === q) score += 100;
        else if (item.id.includes(q) || item.displayName.toLowerCase().includes(q)) score += 50;
        if (item.description.toLowerCase().includes(q)) score += 20;
        if (item.tags?.some((x) => x.toLowerCase().includes(q))) score += 15;
        return { item, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }
}
