/**
 * 统一 HTTP 取数层
 *
 * 桌面端的 Core 子进程跑在 Electron 内置 Node 里，不认 NODE_USE_ENV_PROXY，
 * 直连 GitHub 在国内会直接失败；而系统 curl 会读 https_proxy 环境变量。
 * 所以这里做了降级策略：有代理就用 curl，没有代理先试原生 fetch，失败再退回 curl。
 *
 * 配置项 `proxy` 可显式指定（如 http://127.0.0.1:7897），留空则读环境变量。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface HttpOptions {
  timeoutSec?: number;
  proxy?: string;
}

export interface HttpResult {
  status: number;
  body: string;
}

const UA = 'cortico-world-localskills';

/** 从环境变量取代理；大小写都认，优先 https。 */
export function proxyFromEnv(): string {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  ).trim();
}

function resolveProxy(explicit?: string): string {
  return (explicit || proxyFromEnv()).trim();
}

function curlArgs(url: string, timeoutSec: number, proxy?: string): string[] {
  const args = ['-sL', '--max-time', String(timeoutSec), '-A', UA, '-w', '\n%{http_code}'];
  const p = (proxy || '').trim();
  if (p) args.push('-x', p);
  args.push(url);
  return args;
}

function runCurl(url: string, timeoutSec: number, proxy?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    execFile('curl', curlArgs(url, timeoutSec, proxy), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(`curl 请求失败：${err.message}`));
        return;
      }
      const text = String(stdout);
      const idx = text.lastIndexOf('\n');
      const status = Number(text.slice(idx + 1).trim());
      resolve({ status: Number.isFinite(status) ? status : 0, body: text.slice(0, idx) });
    });
  });
}

async function runFetch(url: string, timeoutSec: number): Promise<HttpResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });
  return { status: res.status, body: await res.text() };
}

/** GET 文本：有代理走 curl，否则优先 fetch、失败回退 curl。 */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const timeoutSec = opts.timeoutSec ?? 15;
  const proxy = resolveProxy(opts.proxy);
  if (proxy) return runCurl(url, timeoutSec, proxy);
  try {
    return await runFetch(url, timeoutSec);
  } catch {
    return runCurl(url, timeoutSec);
  }
}

/** GET 并解析 JSON，非 2xx 抛错。 */
export async function httpGetJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpGet(url, opts);
  if (res.status < 200 || res.status >= 300) {
    if (res.status === 403) throw new Error('GitHub 接口限流（未认证 60 次/小时），请稍后再试');
    if (res.status === 404) throw new Error('地址不存在（404），请检查技能源配置');
    throw new Error(`HTTP ${res.status}`);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error('返回内容不是合法 JSON');
  }
}

/** 下载二进制到指定文件：有代理走 curl -o，否则 fetch 后写盘。 */
export async function httpDownload(url: string, dest: string, opts: HttpOptions = {}): Promise<void> {
  const timeoutSec = opts.timeoutSec ?? 30;
  const proxy = resolveProxy(opts.proxy);
  if (proxy) {
    await new Promise<void>((resolve, reject) => {
      const args = ['-sL', '--max-time', String(timeoutSec), '-A', UA, '-o', dest, '-w', '%{http_code}', url];
      const full = ['-x', proxy, ...args];
      execFile('curl', full, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) {
          reject(new Error(`下载失败：${err.message}`));
          return;
        }
        const status = Number(String(stdout).trim());
        if (status && (status < 200 || status >= 300)) {
          reject(new Error(`下载失败：HTTP ${status}`));
          return;
        }
        resolve();
      });
    });
    return;
  }

  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutSec * 1000) });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** 下载到临时目录并读回 Buffer，用于小文件（技能资源）。 */
export async function httpGetBuffer(url: string, opts: HttpOptions = {}): Promise<Buffer> {
  const timeoutSec = opts.timeoutSec ?? 30;
  const proxy = resolveProxy(opts.proxy);
  if (!proxy) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutSec * 1000) });
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const dir = mkdtempSync(join(tmpdir(), 'skill-dl-'));
  const file = join(dir, 'blob');
  try {
    await httpDownload(url, file, { timeoutSec, proxy });
    return readFileSync(file);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
