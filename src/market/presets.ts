/**
 * 本地预置的成熟技能推荐库与种子模板
 * 解决直连 GitHub 容易超时或网络不通的问题，实现 100% 离线可用与便捷安装
 */
import type { MarketIndexEntry } from '../types.ts';

export interface PresetSkillPackage extends MarketIndexEntry {
  /** 预置的 SKILL.md 完整内容 */
  skillContent: string;
}

export const PRESET_MATURE_SKILLS: PresetSkillPackage[] = [
  {
    id: 'git-commit',
    displayName: 'Git 规范化提交 (Conventional Commits)',
    description: '自动分析当前 git diff 差异，生成标准 Conventional Commits 语义化提交信息并执行提交。',
    version: '1.2.0',
    author: 'cortico-team',
    license: 'MIT',
    tags: ['git', 'workflow', 'dev'],
    downloadUrl: 'builtin://git-commit',
    summary: { skillLines: 125, files: 1, loadChars: 2700 },
    skillContent: `---
name: git-commit
description: Execute git commit with conventional commit message analysis, intelligent scope detection, and commit preview.
allowed-tools: Bash
version: 1.2.0
license: MIT
---

# Git Commit with Conventional Commits

## Overview
Generate clear, standardized conventional commit messages according to Conventional Commits 1.0.0.

## Workflow
1. Check \`git status\` and \`git diff --staged\` to inspect changes.
2. Formulate commit message: \`<type>(<optional scope>): <description>\`.
   - feat: A new feature
   - fix: A bug fix
   - docs: Documentation only changes
   - style: Changes that do not affect the meaning of the code
   - refactor: A code change that neither fixes a bug nor adds a feature
   - perf: A code change that improves performance
   - test: Adding missing tests or correcting existing tests
   - chore: Changes to the build process or auxiliary tools
3. Present the message clearly to the user before committing.
`,
  },
  {
    id: 'ffmpeg-video-editor',
    displayName: 'FFmpeg 媒体处理与无损剪辑',
    description: '使用 GPU 硬件加速（NVENC/QSV/AMF）或高保真压制，提供视频无损剪辑、音频提取、格式转换与压制工具。',
    version: '1.5.0',
    author: 'media-tools',
    license: 'MIT',
    tags: ['media', 'ffmpeg', 'video', 'gpu'],
    downloadUrl: 'builtin://ffmpeg-video-editor',
    summary: { skillLines: 98, files: 1, loadChars: 2200 },
    skillContent: `---
name: ffmpeg-video-editor
description: Video and audio manipulation, cutting, format conversion and GPU-accelerated encoding using FFmpeg.
allowed-tools: Bash
version: 1.5.0
license: MIT
---

# FFmpeg Video & Media Automation

## Rules
- Always prioritize GPU hardware acceleration (h264_nvenc, hevc_nvenc, h264_qsv, h264_amf).
- Never fallback to CPU libx264 unless explicitly instructed or no GPU is available.
- Stream copy (-c copy) when trimming without recoding.
`,
  },
  {
    id: 'markitdown-skill',
    displayName: 'MarkItDown 万能文档解析转换',
    description: '将 PDF、Word (.docx)、PPT、Excel、HTML 及图像转换为清晰优雅的 Markdown 文本供模型精准阅读。',
    version: '1.1.0',
    author: 'microsoft',
    license: 'MIT',
    tags: ['office', 'markdown', 'converter'],
    downloadUrl: 'builtin://markitdown-skill',
    summary: { skillLines: 85, files: 1, loadChars: 1950 },
    skillContent: `---
name: markitdown-skill
description: Convert various document formats (PDF, DOCX, XLSX, PPTX, HTML, Audio) into Markdown text for LLMs.
allowed-tools: Bash
version: 1.1.0
license: MIT
---

# MarkItDown Converter

## Usage
Convert documents to markdown using Python \`markitdown\` CLI:
\`\`\`bash
markitdown path/to/document.pdf > output.md
\`\`\`
`,
  },
  {
    id: 'playwright-browser-automation',
    displayName: 'Playwright 网页无头浏览与自动化',
    description: '强大的端到端浏览器自动化、网页抓取、表单交互与页面全屏截图生成。',
    version: '2.0.0',
    author: 'automation',
    license: 'Apache-2.0',
    tags: ['browser', 'automation', 'playwright', 'scraping'],
    downloadUrl: 'builtin://playwright-browser-automation',
    summary: { skillLines: 110, files: 1, loadChars: 2400 },
    skillContent: `---
name: playwright-browser-automation
description: Automate browser actions, navigate websites, click elements, fill inputs, and take screenshots via Playwright.
allowed-tools: Bash
version: 2.0.0
license: Apache-2.0
---

# Playwright Browser Automation

Use headless browser to visit web pages, extract content, capture high-res screenshots, and interact with complex web apps.
`,
  },
  {
    id: 'minimax-docx',
    displayName: 'Word 文档 (.docx) 智能生成与排版',
    description: '基于 python-docx 按照设计规范生成专业的 Word 文档、红头文件、报告与学术论文排版。',
    version: '1.0.2',
    author: 'office-kit',
    license: 'MIT',
    tags: ['office', 'docx', 'word'],
    downloadUrl: 'builtin://minimax-docx',
    summary: { skillLines: 130, files: 1, loadChars: 2900 },
    skillContent: `---
name: minimax-docx
description: Create, edit, and layout Microsoft Word (.docx) documents with rich typography and tables.
allowed-tools: Bash
version: 1.0.2
license: MIT
---

# Word (.docx) Document Generator

Generate elegant .docx documents using bundled python-docx library.
`,
  },
  {
    id: 'dsh-update-maintenance',
    displayName: 'DSH 框架更新与故障诊断维护',
    description: 'DeepSeek Harness 客户端环境状态检查、插件同步对齐、更新日志查看与疑难排障指引。',
    version: '1.0.0',
    author: 'dsh-team',
    license: 'MIT',
    tags: ['dsh', 'maintenance', 'diagnostics'],
    downloadUrl: 'builtin://dsh-update-maintenance',
    summary: { skillLines: 90, files: 1, loadChars: 2100 },
    skillContent: `---
name: dsh-update-maintenance
description: Guide for DeepSeek Harness desktop diagnostics, extensions update, and environment sync.
allowed-tools: Bash
version: 1.0.0
license: MIT
---

# DSH Maintenance & Diagnostics

Follow standard operations in ENVIRONMENT.md and AGENTS.md for package alignment.
`,
  },
];
