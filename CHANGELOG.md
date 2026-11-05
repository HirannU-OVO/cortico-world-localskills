# 更新日志

本文件记录「本地技能库 (cortico-world-localskills)」扩展的版本变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.4] - 2026-11-05

> 让桌宠拥有一个按 Claude Skill 规范组织的本地技能库：扫描、分段阅读、检索、三态控制与市场安装。

### 新增

- **技能扫描与解析**：自动扫描多源技能目录，解析 `SKILL.md` 正文、YAML frontmatter 元数据与 `references/` 等附带资源。
- **三态生命周期**：启用（自动注入提示词）/ 仅手动（模型按需读取）/ 禁用，面板可切换。
- **分段阅读**：`skill_load(name, offset, limit)` 支持超长技能按 `maxLoadChars` 分段续读，避免撑爆上下文。
- **全文检索**：`skill_search` 在技能名称、描述与正文中做关键词匹配。
- **技能市场**：`skill_install` / `skill_update` / `skill_uninstall` 从市场索引安装、检查更新与卸载（默认索引源为 Anthropic 官方技能仓）。
- **沙箱与安全**：模型写入需显式开启 `allowModelWrite`；卸载归档到回收站；技能包体积、文件数、下载超时均可配置。
- **WebUI 面板**：技能列表、状态切换、市场页与配置分组。

### 优化

- 配置项按真实 schema 对齐（`dirs` / `maxLoadChars` / `marketIndexUrl` / `installDir` / `allowPrerelease` 等），面板与配置文件同名同义。
- 支持自定义市场源与预发布版本开关，默认关闭以减少误装。
