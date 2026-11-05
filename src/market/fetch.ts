/**
 * 安全下载与网络请求
 * 支持超时、文件大小上限与 SHA256 校验
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

export interface DownloadOptions {
  maxBytes: number;
  timeoutSec: number;
  signal?: AbortSignal;
}

export async function downloadFile(url: string, destPath: string, opts: DownloadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const getter = isHttps ? httpsGet : httpGet;

    let totalBytes = 0;
    const fileStream = createWriteStream(destPath);

    const req = getter(url, (res) => {
      // 处理重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fileStream.close();
        try {
          if (existsSync(destPath)) rmSync(destPath, { force: true });
        } catch {
          // ignore
        }
        return downloadFile(res.headers.location, destPath, opts).then(resolve, reject);
      }

      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        fileStream.close();
        try {
          if (existsSync(destPath)) rmSync(destPath, { force: true });
        } catch {
          // ignore
        }
        return reject(new Error(`下载响应失败，HTTP 状态码: ${res.statusCode}`));
      }

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > opts.maxBytes) {
          req.destroy();
          fileStream.close();
          try {
            if (existsSync(destPath)) rmSync(destPath, { force: true });
          } catch {
            // ignore
          }
          reject(new Error(`下载内容超过单包体积上限 (${totalBytes} > ${opts.maxBytes} bytes)`));
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        try {
          if (existsSync(destPath)) rmSync(destPath, { force: true });
        } catch {
          // ignore
        }
        reject(err);
      });
    });

    req.setTimeout(opts.timeoutSec * 1000, () => {
      req.destroy();
      try {
        if (existsSync(destPath)) rmSync(destPath, { force: true });
      } catch {
        // ignore
      }
      reject(new Error(`下载超时 (${opts.timeoutSec} 秒)`));
    });

    req.on('error', (err) => {
      try {
        if (existsSync(destPath)) rmSync(destPath, { force: true });
      } catch {
        // ignore
      }
      reject(err);
    });

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        req.destroy();
        try {
          if (existsSync(destPath)) rmSync(destPath, { force: true });
        } catch {
          // ignore
        }
        reject(new Error('下载已被取消'));
      });
    }
  });
}

export function verifySha256(filePath: string, expectedHash: string): boolean {
  try {
    const buffer = readFileSync(filePath);
    const hash = createHash('sha256').update(buffer).digest('hex').toLowerCase();
    const cleanExpected = expectedHash.replace(/^sha256:/i, '').trim().toLowerCase();
    return hash === cleanExpected;
  } catch {
    return false;
  }
}
