/**
 * GitHub 目录型技能源
 *
 * anthropics/skills 这类仓库没有 zip 索引，只有 `skills/<name>/SKILL.md` 的目录结构。
 * 这里直接走 GitHub Contents API 列目录、按 raw 逐文件拉取，装成普通技能目录。
 * 与静态索引（$meta + map）互为补充：静态索引给 zip 直链，这个源给目录。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { parseFrontmatter } from '../core/frontmatter.ts';
import type { MarketIndexEntry } from '../types.ts';
import { httpGet, httpGetBuffer, httpGetJson } from './http.ts';

export interface GithubSource {
  /** owner/repo */
  repo: string;
  /** 仓内路径，如 skills */
  path: string;
  branch: string;
  /** Contents API 地址 */
  apiUrl: string;
  /** raw 基地址，拼在技能名前面 */
  rawBase: string;
}

const DEFAULT_BRANCH = 'main';

/**
 * 解析技能源地址，支持四种写法：
 *   https://api.github.com/repos/<owner>/<repo>/contents/<path>
 *   https://github.com/<owner>/<repo>/tree/<branch>/<path>
 *   <owner>/<repo>[/<path>]
 *   https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
 */
export function parseGithubSource(input: string): GithubSource | null {
  const raw = (input || '').trim().replace(/\/+$/, '');
  if (!raw) return null;

  const build = (owner: string, repo: string, path: string, branch: string): GithubSource => {
    const cleanPath = path.replace(/^\/+|\/+$/g, '');
    const suffix = cleanPath ? `/${cleanPath}` : '';
    return {
      repo: `${owner}/${repo}`,
      path: cleanPath,
      branch,
      apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents${suffix}?ref=${branch}`,
      rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${suffix}`,
    };
  };

  // 1) Contents API
  const api = /^https?:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/contents\/?([^?]*)(?:\?ref=([^&]+))?/i.exec(raw);
  if (api) return build(api[1], api[2], api[3] || '', api[4] || DEFAULT_BRANCH);

  // 2) raw 地址
  const rawUrl = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i.exec(raw);
  if (rawUrl) return build(rawUrl[1], rawUrl[2], rawUrl[4], rawUrl[3]);

  // 3) 网页地址
  const web = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)\/?(.*))?$/i.exec(raw);
  if (web) return build(web[1], web[2], web[4] || '', web[3] || DEFAULT_BRANCH);

  // 4) 简写 owner/repo[/path]
  if (!raw.includes('://')) {
    const short = /^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/.exec(raw);
    if (short) return build(short[1], short[2], short[3] || '', DEFAULT_BRANCH);
  }
  return null;
}

interface GhEntry {
  name: string;
  path: string;
  type: string;
  url?: string;
  download_url?: string | null;
  sha?: string;
}

interface GhTreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

/**
 * 用 git trees API 一次拿到整棵树的 blob sha，按技能目录聚合成内容指纹。
 *
 * 官方技能大多没有 version 字段，靠版本号判断不出更新，只能比内容；
 * 一次请求覆盖全部技能，比逐个读目录省得多（限流 60 次/小时）。
 */
export async function fetchGithubDirHashes(
  src: GithubSource,
  opts: { timeoutSec?: number } = {}
): Promise<Map<string, string>> {
  const url = `https://api.github.com/repos/${src.repo}/git/trees/${src.branch}?recursive=1`;
  const data = await httpGetJson<{ tree?: GhTreeEntry[] }>(url, { timeoutSec: opts.timeoutSec ?? 15 });
  const prefix = src.path ? `${src.path}/` : '';
  const grouped = new Map<string, string[]>();

  for (const item of data.tree || []) {
    if (item.type !== 'blob' || !item.path.startsWith(prefix)) continue;
    const rest = item.path.slice(prefix.length);
    const skillName = rest.split('/')[0];
    if (!skillName) continue;
    const list = grouped.get(skillName) ?? [];
    list.push(`${rest}:${item.sha}`);
    grouped.set(skillName, list);
  }

  const out = new Map<string, string>();
  for (const [name, list] of grouped) {
    list.sort();
    out.set(name, createHash('sha256').update(list.join('|')).digest('hex').slice(0, 16));
  }
  return out;
}

/**
 * 列出目录下的技能（一级子目录），并读每个技能 SKILL.md 的 frontmatter 补全展示信息。
 * 单个技能读取失败不影响整体列表。
 */
export async function fetchGithubEntries(
  src: GithubSource,
  opts: { timeoutSec?: number; concurrency?: number } = {}
): Promise<MarketIndexEntry[]> {
  const timeoutSec = opts.timeoutSec ?? 15;
  const list = await httpGetJson<GhEntry[]>(src.apiUrl, { timeoutSec });
  if (!Array.isArray(list)) throw new Error('GitHub 目录返回格式异常');

  // 整棵树的内容指纹：拿不到也不影响列表，只是这一轮判不了更新
  let dirHashes = new Map<string, string>();
  try {
    dirHashes = await fetchGithubDirHashes(src, { timeoutSec });
  } catch {
    // ignore
  }

  const dirs = list.filter((x) => x.type === 'dir');
  const entries: MarketIndexEntry[] = [];
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 10));
  let cursor = 0;

  const worker = async () => {
    while (cursor < dirs.length) {
      const dir = dirs[cursor++];
      const base = `${src.rawBase}/${encodeURIComponent(dir.name)}`;
      let fm: Record<string, string> = {};
      try {
        const md = await httpGet(`${base}/SKILL.md`, { timeoutSec });
        if (md.status === 200 && md.body) {
          fm = parseFrontmatter(md.body).data as Record<string, string>;
        }
      } catch {
        // 读不到说明就退化成空描述，不影响挂牌
      }
      entries.push({
        id: dir.name,
        displayName: fm.name || dir.name,
        description: fm.description || '',
        version: fm.version || '1.0.0',
        author: src.repo.split('/')[0],
        license: fm.license,
        tags: ['github'],
        repo: src.repo,
        path: dir.path,
        downloadUrl: base,
        provider: 'github',
        rawBase: src.rawBase,
        contentHash: dirHashes.get(dir.name),
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, dirs.length) }, worker));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

/**
 * 把一个技能目录（多文件）逐级拉取到 destDir。
 * 累计文件数与字节数，超限立即中止；任何逃逸路径直接拒绝。
 */
export async function downloadGithubSkillDir(
  entry: MarketIndexEntry,
  destDir: string,
  opts: { maxBytes: number; maxFiles: number; timeoutSec?: number }
): Promise<void> {
  const src =
    parseGithubSource(entry.downloadUrl) ||
    (entry.repo ? parseGithubSource(entry.path ? `${entry.repo}/${entry.path}` : entry.repo) : null);
  if (!src) throw new Error('无法解析该技能的 GitHub 来源地址');

  const timeoutSec = opts.timeoutSec ?? 30;
  let files = 0;
  let bytes = 0;

  const walk = async (apiUrl: string, relDir: string): Promise<void> => {
    const list = await httpGetJson<GhEntry[]>(apiUrl, { timeoutSec });
    if (!Array.isArray(list)) throw new Error('技能目录返回格式异常');

    for (const item of list) {
      const relPath = relDir ? `${relDir}/${item.name}` : item.name;
      if (item.type === 'dir') {
        if (relPath.split('/').length > 6) throw new Error(`目录层级过深：${relPath}`);
        if (!item.url) continue;
        await walk(item.url, relPath);
        continue;
      }
      if (item.type !== 'file' || !item.download_url) continue;

      files += 1;
      if (files > opts.maxFiles) throw new Error(`技能文件数超出上限（${opts.maxFiles}）`);

      const buf = await httpGetBuffer(item.download_url, { timeoutSec });
      bytes += buf.length;
      if (bytes > opts.maxBytes) {
        throw new Error(`技能体积超出上限（${Math.round(opts.maxBytes / (1024 * 1024))} MB）`);
      }

      const target = join(destDir, ...relPath.split('/').filter(Boolean));
      const relCheck = relative(destDir, target);
      if (!relCheck || relCheck.startsWith('..') || isAbsolute(relCheck)) {
        throw new Error(`检测到非法路径：${relPath}`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, buf);
    }
  };

  await walk(src.apiUrl, '');
  if (!files) throw new Error('该技能目录为空');
}
