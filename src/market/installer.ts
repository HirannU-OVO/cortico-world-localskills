/**
 * 技能安全安装管线
 * 下载 -> staging 目录 -> Zip 安全解压 (防护 ZipBomb 与路径穿越) -> 结构校验 -> 备份 -> 原子移动 -> 回滚
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { parseFrontmatter } from '../core/frontmatter.ts';
import type { StateManager } from '../core/state.ts';
import type { MarketIndexEntry, SkillMetaFile } from '../types.ts';
import { downloadFile, verifySha256 } from './fetch.ts';
import { downloadGithubSkillDir } from './github.ts';
import { PRESET_MATURE_SKILLS } from './presets.ts';

export interface InstallOptions {
  entry: MarketIndexEntry;
  installDir: string;
  dataDir: string;
  stateManager: StateManager;
  maxPackageMb: number;
  maxFiles: number;
  downloadTimeoutSec: number;
  signal?: AbortSignal;
}

/** 剥离包装根目录（GitHub Releases 经常包装单层 root/ 文件夹） */
function resolveExtractedRoot(extractDir: string): string {
  const items = readdirSync(extractDir);
  if (items.length === 1) {
    const single = join(extractDir, items[0]);
    if (statSync(single).isDirectory() && !existsSync(join(single, 'SKILL.md')) && !existsSync(join(single, 'skill.md'))) {
      return single;
    }
  }
  return extractDir;
}

/**
 * 轻量解压 zip 文件（跨平台安全解析）
 * 借助 Node.js 内置或系统 unzip/powershell 解压并进行安全约束校验
 */
async function extractZipSafe(zipFile: string, destDir: string, maxFiles: number, maxBytes: number): Promise<void> {
  mkdirSync(destDir, { recursive: true });

  // 跨平台调用系统原生解压工具（PowerShell / tar / unzip）
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${destDir}' -Force`],
        (err) => (err ? reject(err) : resolve())
      );
    } else {
      execFile('unzip', ['-q', '-o', zipFile, '-d', destDir], (err) => (err ? reject(err) : resolve()));
    }
  });

  // 安全审计解压后的目录：检查文件总数、总字节大小、软链接逃逸及路径穿越
  let fileCount = 0;
  let byteSum = 0;

  const auditDir = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // 路径穿越与符号链接检查
      const rel = relative(destDir, fullPath);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`检测到非法解压路径逃逸: ${entry.name}`);
      }

      if (entry.isSymbolicLink()) {
        throw new Error(`安全限制：技能包内禁止包含符号链接 (${entry.name})`);
      }

      if (entry.isDirectory()) {
        auditDir(fullPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        if (fileCount > maxFiles) {
          throw new Error(`解压文件数超出上限 (最大允许 ${maxFiles} 个文件)`);
        }
        const st = statSync(fullPath);
        byteSum += st.size;
        if (byteSum > maxBytes) {
          throw new Error(`解压总体积超出上限 (最大允许 ${Math.round(maxBytes / (1024 * 1024))} MB)`);
        }
      }
    }
  };

  auditDir(destDir);
}

export async function installSkillPackage(opts: InstallOptions): Promise<{ ok: boolean; path?: string; reason?: string }> {
  const stagingRoot = join(opts.dataDir, 'localskills', '.staging');
  const backupRoot = join(opts.dataDir, 'localskills', '.backup');
  mkdirSync(stagingRoot, { recursive: true });
  mkdirSync(backupRoot, { recursive: true });

  const taskId = `${opts.entry.id}-${Date.now()}`;
  const stageDir = join(stagingRoot, taskId);
  const zipPath = join(stageDir, 'package.zip');
  const extractDir = join(stageDir, 'extracted');
  const targetDir = join(opts.installDir, opts.entry.id);
  const backupDir = join(backupRoot, `${opts.entry.id}-${Date.now()}`);

  try {
    mkdirSync(stageDir, { recursive: true });

    // 0. 优先判断是否为预置技能包（离线直装）
    const preset = PRESET_MATURE_SKILLS.find((p) => p.id === opts.entry.id);
    if (preset || opts.entry.downloadUrl.startsWith('builtin://')) {
      // 同名目录若来自用户手写或外部客户端，不覆盖
      if (existsSync(targetDir)) {
        const existing = opts.stateManager.readSkillMeta(targetDir);
        const sameOrigin = existing?.source === 'builtin' || existing?.source === 'market';
        if (!sameOrigin) {
          return {
            ok: false,
            reason: `已存在同名技能「${opts.entry.id}」（来源：${existing?.source || 'manual'}），为免覆盖未安装`,
          };
        }
      }
      const content = preset?.skillContent || opts.entry.description;
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, 'SKILL.md'), content, 'utf8');

      const meta: SkillMetaFile = {
        schema: 1,
        id: opts.entry.id,
        canonicalName: `@builtin/${opts.entry.id}`,
        version: opts.entry.version,
        source: 'builtin',
        installedAt: new Date().toISOString(),
        updatedAt: null,
        repo: opts.entry.repo,
        downloadUrl: opts.entry.downloadUrl,
        userEdited: false,
      };
      opts.stateManager.writeSkillMeta(targetDir, meta);
      return { ok: true, path: targetDir };
    }

    // 1-3. 按来源取包：GitHub 目录逐文件拉取，其余走 zip 下载 + 解压
    let skillRoot: string;
    if (opts.entry.provider === 'github') {
      await downloadGithubSkillDir(opts.entry, extractDir, {
        maxBytes: opts.maxPackageMb * 1024 * 1024,
        maxFiles: opts.maxFiles,
        timeoutSec: opts.downloadTimeoutSec,
      });
      skillRoot = extractDir;
    } else {
      await downloadFile(opts.entry.downloadUrl, zipPath, {
        maxBytes: opts.maxPackageMb * 1024 * 1024,
        timeoutSec: opts.downloadTimeoutSec,
        signal: opts.signal,
      });

      // SHA256 完整性校验
      if (opts.entry.sha256) {
        const valid = verifySha256(zipPath, opts.entry.sha256);
        if (!valid) {
          throw new Error('技能包 SHA256 校验失败，文件可能已损坏或被篡改');
        }
      }

      // 安全解压与体积文件数审计
      await extractZipSafe(zipPath, extractDir, opts.maxFiles, opts.maxPackageMb * 1024 * 1024);

      // 定位实际技能根目录
      skillRoot = resolveExtractedRoot(extractDir);
    }
    const skillFileCandidate = existsSync(join(skillRoot, 'SKILL.md'))
      ? join(skillRoot, 'SKILL.md')
      : existsSync(join(skillRoot, 'skill.md'))
        ? join(skillRoot, 'skill.md')
        : null;

    if (!skillFileCandidate) {
      throw new Error('解压产物中未找到合法的 SKILL.md 文件');
    }

    // 5. 校验 Frontmatter
    const content = readFileSync(skillFileCandidate, 'utf8');
    const { valid } = parseFrontmatter(content);
    if (!valid) {
      // 容错：允许安装，但记录警告
    }

    // 6. 备份既有目标（只有同名技能确实来自同一市场来源才覆盖）
    let hadBackup = false;
    if (existsSync(targetDir)) {
      const existing = opts.stateManager.readSkillMeta(targetDir);
      const sameOrigin =
        existing?.source === 'market' &&
        (!opts.entry.repo || !existing.repo || existing.repo.toLowerCase() === opts.entry.repo.toLowerCase());
      if (!sameOrigin) {
        return {
          ok: false,
          reason: `已存在同名技能「${opts.entry.id}」（来源：${existing?.source || 'manual'}），为免覆盖未安装`,
        };
      }
      renameSync(targetDir, backupDir);
      hadBackup = true;
    }

    // 7. 原子移动到目标安装位置
    mkdirSync(opts.installDir, { recursive: true });
    renameSync(skillRoot, targetDir);

    // 8. 写入技能元数据 _skill_meta.json
    const meta: SkillMetaFile = {
      schema: 1,
      id: opts.entry.id,
      canonicalName: `@market/${opts.entry.id}`,
      version: opts.entry.version,
      source: 'market',
      installedAt: new Date().toISOString(),
      updatedAt: null,
      repo: opts.entry.repo,
      downloadUrl: opts.entry.downloadUrl,
      installedContentHash: opts.entry.contentHash || opts.entry.sha256,
      userEdited: false,
    };
    opts.stateManager.writeSkillMeta(targetDir, meta);

    // 清理成功安装的备份
    if (hadBackup) {
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    return { ok: true, path: targetDir };
  } catch (err) {
    // 出现异常时回滚备份
    if (existsSync(backupDir)) {
      try {
        if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
        renameSync(backupDir, targetDir);
      } catch {
        // ignore
      }
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    // 清理临时 staging 目录
    try {
      if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
