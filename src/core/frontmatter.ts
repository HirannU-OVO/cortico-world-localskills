/**
 * 健壮的 Frontmatter 解析器
 * 支持常规 key: value、成对引号、多行块状标量 (>, |)、以及 allowed-tools 数组/列表解析
 */
import type { SkillFrontmatter } from '../types.ts';

const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

function stripQuotes(value: string): string {
  const text = value.trim();
  if (text.length >= 2) {
    const head = text[0];
    const tail = text[text.length - 1];
    if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function parseList(value: string): string[] {
  const inner = value.trim().replace(/^\[|\]$/g, '');
  return inner
    .split(/[,\s]+/)
    .map((s) => s.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

export function parseFrontmatter(text: string): { data: SkillFrontmatter; rawData: Record<string, string>; body: string; valid: boolean } {
  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  let head = 0;
  while (head < lines.length && lines[head].trim() === '') head += 1;

  if (head >= lines.length || lines[head].trim() !== '---') {
    return { data: {}, rawData: {}, body: source.trim(), valid: false };
  }

  let end = -1;
  for (let i = head + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }

  if (end < 0) {
    return { data: {}, rawData: {}, body: source.trim(), valid: false };
  }

  const rawData: Record<string, string> = {};
  let i = head + 1;
  while (i < end) {
    const line = lines[i];
    i += 1;
    if (!line.trim() || /^\s/.test(line)) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    let value = match[2].trim();

    const isBlock = value === '' || value === '>' || value === '|' || value === '>-' || value === '|-';
    if (isBlock) {
      const collected: string[] = [];
      while (i < end && (lines[i].trim() === '' || /^\s/.test(lines[i]))) {
        collected.push(lines[i].replace(/^\s{1,4}/, ''));
        i += 1;
      }
      const joiner = value.startsWith('|') ? '\n' : ' ';
      value = collected.join(joiner).replace(/[ \t]+/g, ' ').trim();
    } else {
      value = stripQuotes(value);
    }

    if (value && !(key in rawData)) {
      rawData[key] = value;
    }
  }

  const data: SkillFrontmatter = {};
  if (rawData['name']) data.name = rawData['name'];
  if (rawData['description']) data.description = rawData['description'];
  if (rawData['whentouse'] || rawData['when-to-use'] || rawData['when_to_use']) {
    data.whenToUse = rawData['whentouse'] || rawData['when-to-use'] || rawData['when_to_use'];
  }
  if (rawData['version']) data.version = rawData['version'];
  if (rawData['license']) data.license = rawData['license'];
  if (rawData['allowed-tools'] || rawData['allowed_tools']) {
    data.allowedTools = parseList(rawData['allowed-tools'] || rawData['allowed_tools'] || '');
  }

  const body = lines.slice(end + 1).join('\n').trim();
  return { data, rawData, body, valid: true };
}

export function fallbackDescription(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#') || text.startsWith('---') || text.startsWith('```')) continue;
    return text.replace(/[#*`_~]/g, '').trim().slice(0, 200);
  }
  return '';
}

export function safeSkillName(raw: string | undefined, fallback: string): string {
  const trimmed = (raw || '').trim().replace(/\s+/g, '-');
  const candidate = !trimmed || INVALID_NAME_CHARS.test(trimmed) ? fallback : trimmed;
  return candidate.replace(new RegExp(INVALID_NAME_CHARS.source, 'g'), '-');
}
