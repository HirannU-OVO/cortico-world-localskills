/**
 * 技能库工具实现
 * 只读工具：skill_list, skill_load (支持 offset/limit 分段续读), skill_read, skill_search
 * 写操作工具：skill_install, skill_uninstall, skill_update (在 allowModelWrite=true 时挂载)
 * 严格遵照 Cortico Core 的 ToolDef 契约：handler: (args) => Promise<string | ToolOutcome>
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ToolDef } from 'cortico/core/types.ts';
import type { SkillScanner } from './core/scanner.ts';
import type { Skill } from './types.ts';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

export interface ToolContext {
  scanner: SkillScanner;
  getMaxChars: () => number;
  getAllowModelWrite: () => boolean;
  /** 新技能的落盘根目录（绝对路径） */
  getInstallRoot: () => string;
  onInstall?: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  onUninstall?: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  onUpdate?: (id: string) => Promise<{ ok: boolean; reason?: string }>;
}

function findMatchingSkill(scanner: SkillScanner, nameOrId: string): Skill | null {
  const all = scanner.scan();
  const target = (nameOrId || '').trim().toLowerCase();
  if (!target) return null;
  // 优先精确匹配 id 或 name（无论是否 off）
  const exact = all.find((s) => s.id === target || s.name.toLowerCase() === target);
  if (exact) return exact.state !== 'off' ? exact : null;
  // 模糊匹配
  const loose = all.filter((s) => s.state !== 'off' && (s.id.includes(target) || s.name.toLowerCase().includes(target)));
  return loose.length === 1 ? loose[0] : null;
}

/** 路径安全检查，防止越界逃逸与符号链接逃逸 */
function safeResolvePath(baseDir: string, relPath: string): string | null {
  if (!relPath || isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath) || /^\\\\/.test(relPath)) {
    return null;
  }
  const target = resolve(baseDir, relPath);
  const rel = relative(baseDir, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  try {
    const realBase = realpathSync(baseDir);
    const realTarget = realpathSync(target);
    const realRel = relative(realBase, realTarget);
    if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) {
      return null;
    }
    return realTarget;
  } catch {
    return null;
  }
}

export function buildSkillTools(ctx: ToolContext): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: 'skill_list',
      description: '列出本机技能库里已启用的专属技能清单（包含名字、描述、适用场景、版本与三态模式）。',
      parameters: {
        type: 'object',
        properties: {
          includeManual: {
            type: 'boolean',
            description: '是否包含仅手动调用的技能，默认为 true',
          },
        },
      },
      tags: ['read'],
      barrierAfter: true,
      handler: async (args) => {
        const includeManual = (args as { includeManual?: boolean })?.includeManual ?? true;
        const skills = ctx.scanner.scan().filter((s) => {
          if (s.state === 'off') return false;
          if (s.state === 'manual' && !includeManual) return false;
          return true;
        });

        if (skills.length === 0) {
          return '技能库当前没有可用技能。';
        }

        const lines = skills.map((s) => {
          const modeTag = s.state === 'manual' ? ' [仅手动]' : '';
          const ver = s.version ? ` (v${s.version})` : '';
          const when = s.whenToUse ? ` | 适用: ${s.whenToUse}` : '';
          return `- ${s.name}${ver}${modeTag}: ${s.description}${when}`;
        });

        return `共有 ${skills.length} 个可用技能：\n\n${lines.join('\n')}\n\n使用 skill_load(name) 查看完整指引，或使用 skill_search(query) 搜索。`;
      },
    },

    {
      name: 'skill_search',
      description: '在技能库的名称、标识符、描述、适用场景及正文中全文搜索匹配的技能。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
          limit: {
            type: 'number',
            description: '最大返回结果数，默认 10',
          },
        },
        required: ['query'],
      },
      tags: ['read'],
      barrierAfter: true,
      handler: async (args) => {
        const { query, limit = 10 } = args as { query: string; limit?: number };
        const q = (query || '').toLowerCase().trim();
        if (!q) {
          return '请输入有效的搜索关键词。';
        }

        const all = ctx.scanner.scan().filter((s) => s.state !== 'off');
        const matched = all
          .map((s) => {
            let score = 0;
            if (s.id === q || s.name.toLowerCase() === q) score += 100;
            else if (s.id.includes(q) || s.name.toLowerCase().includes(q)) score += 50;
            if (s.description.toLowerCase().includes(q)) score += 20;
            if (s.whenToUse.toLowerCase().includes(q)) score += 20;
            if (s.body.toLowerCase().includes(q)) score += 5;
            return { skill: s, score };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (matched.length === 0) {
          return `未找到与 "${query}" 匹配的技能。`;
        }

        const lines = matched.map(({ skill: s }) => {
          const tag = s.state === 'manual' ? ' [仅手动]' : '';
          return `- ${s.name} (${s.id})${tag}: ${s.description}`;
        });

        return `匹配到 ${matched.length} 个技能：\n\n${lines.join('\n')}`;
      },
    },

    {
      name: 'skill_load',
      description: '按技能名读取 SKILL.md 的完整内容。支持 offset 与 limit 分段续读超长技能。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能名字或目录标识符',
          },
          offset: {
            type: 'number',
            description: '起始字符偏移量，用于长技能分段续读，默认 0',
          },
          limit: {
            type: 'number',
            description: '本次读取的最大字符数，缺省时使用配置的单次上限',
          },
        },
        required: ['name'],
      },
      tags: ['read'],
      barrierAfter: true,
      handler: async (args) => {
        const { name, offset = 0, limit } = args as { name: string; offset?: number; limit?: number };
        const skill = findMatchingSkill(ctx.scanner, name);
        if (!skill) {
          return `未找到技能「${name || '（空）'}」或该技能已被停用。`;
        }

        const maxChars = Math.min(limit || ctx.getMaxChars(), ctx.getMaxChars());
        const total = skill.body.length;
        const start = Math.max(0, offset);
        const end = Math.min(total, start + maxChars);
        const slice = skill.body.slice(start, end);

        let output = `技能「${skill.name}」正文 (第 ${start + 1}–${end} 字符，共 ${total} 字符)\n目录：${skill.dir}\n说明：${skill.description}\n`;
        if (skill.whenToUse) output += `适用：${skill.whenToUse}\n`;
        if (skill.allowedTools && skill.allowedTools.length > 0) {
          output += `推荐工具: ${skill.allowedTools.join(', ')}\n`;
        }
        output += `\n---\n${slice}\n`;

        if (end < total) {
          const remaining = total - end;
          output += `\n---\n还有 ${remaining} 字符未读取。可通过调用 skill_load({ name: "${skill.id}", offset: ${end} }) 续读。`;
        }

        if (skill.resources.length > 0) {
          output += `\n\n资源文件（可用 skill_read 读取）: ${skill.resources.slice(0, 20).join(', ')}`;
        }

        return output;
      },
    },

    {
      name: 'skill_read',
      description: '读取某个技能目录内附带的参考文件、模板或配置（如 references/ 等）。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能名字或目录标识符',
          },
          path: {
            type: 'string',
            description: '相对技能根目录的文件路径（如 references/doc.md）',
          },
        },
        required: ['name', 'path'],
      },
      tags: ['read'],
      barrierAfter: true,
      handler: async (args) => {
        const { name, path: relPath } = args as { name: string; path: string };
        const skill = findMatchingSkill(ctx.scanner, name);
        if (!skill) {
          return `未找到技能「${name || '（空）'}」或该技能已被停用。`;
        }

        const target = safeResolvePath(skill.dir, relPath);
        if (!target || !existsSync(target)) {
          return `资源文件不存在或非法越界访问: ${relPath}。可用资源列表: ${skill.resources.join(', ') || '无'}`;
        }

        let st;
        try {
          st = statSync(target);
        } catch {
          return `无法访问资源: ${relPath}`;
        }

        if (!st.isFile()) {
          return `目标不是文件: ${relPath}`;
        }

        if (st.size > MAX_FILE_SIZE) {
          return `资源文件过大 (${st.size} bytes > 2 MB)，请用 sh / fs_read 分段读取。`;
        }

        try {
          const text = readFileSync(target, 'utf8');
          const maxChars = ctx.getMaxChars();
          if (text.length > maxChars) {
            return `${text.slice(0, maxChars)}\n\n…（已截断，原文 ${text.length} 字）`;
          }
          return text;
        } catch (e) {
          return `读取失败: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
  ];

  // 如果启用了模型写权限，挂载安装/卸载/更新工具
  if (ctx.getAllowModelWrite()) {
    tools.push(
      {
        name: 'skill_create',
        description:
          '在本机技能库里新建一个技能（写 SKILL.md 与元数据）。当现有技能都不适用、而这套做法以后还会重复用时使用；一次性的临时操作不要建技能。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名，同时作为目录名：小写字母/数字/点/下划线/连字符，≤64' },
            description: { type: 'string', description: '一句话说明：这个技能做什么、什么时候该用' },
            body: { type: 'string', description: 'SKILL.md 正文（Markdown），按步骤写清做法与坑' },
            whenToUse: { type: 'string', description: '可选：更具体的触发场景' },
            allowedTools: {
              type: 'array',
              items: { type: 'string' },
              description: '可选：需要的工具，如 Bash、Read',
            },
          },
          required: ['name', 'description', 'body'],
        },
        tags: ['write'],
        barrierAfter: true,
        handler: async (args) => {
          const a = args as {
            name?: string;
            description?: string;
            body?: string;
            whenToUse?: string;
            allowedTools?: string[];
          };
          const id = String(a.name || '')
            .trim()
            .toLowerCase();
          if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
            return '技能名不合法：只允许小写字母、数字、点、下划线、连字符，需以字母或数字开头，最长 64 字符';
          }
          const desc = String(a.description || '').trim();
          const body = String(a.body || '').trim();
          if (!desc) return 'description 不能为空：写清这个技能做什么、什么时候用';
          if (!body) return 'body 不能为空：至少写清步骤';

          const root = ctx.getInstallRoot();
          const dir = join(root, id);
          if (existsSync(dir)) {
            return `技能「${id}」已存在，未覆盖。要看现有内容用 skill_read，或换一个名字`;
          }

          // 组装 frontmatter：name 已校验字符集可直接裸写，其余用 JSON 转义成 YAML 双引号字符串
          const fm = ['---', `name: ${id}`, `description: ${JSON.stringify(desc)}`];
          const whenToUse = String(a.whenToUse || '').trim();
          if (whenToUse) fm.push(`whenToUse: ${JSON.stringify(whenToUse)}`);
          const allowed = Array.isArray(a.allowedTools) ? a.allowedTools.filter(Boolean) : [];
          if (allowed.length) fm.push(`allowed-tools: ${allowed.join(', ')}`);
          fm.push('version: 1.0.0', '---', '');

          try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'SKILL.md'), `${fm.join('\n')}\n${body}\n`, 'utf8');
            writeFileSync(
              join(dir, '_skill_meta.json'),
              JSON.stringify(
                {
                  schema: 1,
                  id,
                  canonicalName: `@local/${id}`,
                  version: '1.0.0',
                  source: 'created',
                  installedAt: new Date().toISOString(),
                  updatedAt: null,
                  userEdited: false,
                },
                null,
                2
              ),
              'utf8'
            );
            ctx.scanner.invalidate();
            return `已创建技能「${id}」：${dir}\n下次 skill_list 就能看到，之后按 skill_load 使用。`;
          } catch (err) {
            return `创建失败：${err instanceof Error ? err.message : String(err)}`;
          }
        },
      },
      {
        name: 'skill_install',
        description: '从技能市场中安装指定的技能。仅在配置开启 allowModelWrite 时可用。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '技能市场中的技能 ID' },
          },
          required: ['id'],
        },
        tags: ['write'],
        barrierAfter: true,
        handler: async (args) => {
          const targetId = (args as { id: string }).id;
          if (!ctx.onInstall) return '安装处理器未初始化';
          const res = await ctx.onInstall(targetId);
          return res.ok ? `技能 ${targetId} 安装成功` : `安装失败: ${res.reason}`;
        },
      },
      {
        name: 'skill_uninstall',
        description: '卸载指定技能并移入回收站。仅在配置开启 allowModelWrite 时可用。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '待卸载的技能 ID' },
          },
          required: ['id'],
        },
        tags: ['write'],
        barrierAfter: true,
        handler: async (args) => {
          const targetId = (args as { id: string }).id;
          if (!ctx.onUninstall) return '卸载处理器未初始化';
          const res = await ctx.onUninstall(targetId);
          return res.ok ? `技能 ${targetId} 已移入回收站` : `卸载失败: ${res.reason}`;
        },
      },
      {
        name: 'skill_update',
        description: '更新市场安装的技能到最新版本。仅在配置开启 allowModelWrite 时可用。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '技能 ID' },
          },
          required: ['id'],
        },
        tags: ['write'],
        barrierAfter: true,
        handler: async (args) => {
          const targetId = (args as { id: string }).id;
          if (!ctx.onUpdate) return '更新处理器未初始化';
          const res = await ctx.onUpdate(targetId);
          return res.ok ? `技能 ${targetId} 更新成功` : `更新失败: ${res.reason}`;
        },
      }
    );
  }

  return tools;
}
