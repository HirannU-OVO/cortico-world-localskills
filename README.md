# cortico-world-localskills

> **Cortico World 扩展**：为 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 桌面宠物提供按 Claude Skill 标准规范运行的本地技能库支持。

支持技能多源扫描、分段阅读、向量/全文检索、安全三态控制（启用/禁用/仅手动）以及在线技能市场安装与卸载。

---

## 核心特性

- **标准 Claude Skill 兼容**：自动扫描并解析各技能目录下的 `SKILL.md` 正文、YAML 元数据与 `references/` 等参考资源；
- **三态生命周期管理**：支持「启用（自动感知并注入提示词）」、「仅手动（模型仅在明确需要时按需读取）」与「禁用」三种工作模式；
- **超长技能分页分段读取**：通过 `offset` 和 `limit` 机制规避超长 Prompt 对上下文窗口的冲击；
- **全文本地检索**：针对技能名称、场景说明与技能正文提供快速检索能力；
- **技能市场与沙箱管理**：支持从市场一键安装技能，并在卸载时安全归档至回收站，具备细粒度的写入权限控制。

---

## 安装与快速上手

### 1. 放置扩展
将本扩展目录放置于桌宠本地扩展目录中：
```
%COOPANION_DIR%/data/extensions/local/cortico-world-localskills/
```

### 2. 启用扩展
在 Coopanion 的扩展管理中启用本扩展，或直接在 `config.json` 中配置：
```jsonc
{
  "worlds": {
    "skills": {
      "enabled": true
    }
  }
}
```

---

## 工具列表

本扩展向模型注册了以下核心工具：

| 工具名 | 权限分类 | 作用与机制 |
| :--- | :---: | :--- |
| `skill_list(includeManual?)` | 只读 | 列出当前已启用的本地技能清单（名称、说明、适用场景与触发模式） |
| `skill_load(name, offset?, limit?)` | 只读 | 读取指定技能的完整说明（`SKILL.md` 正文），支持长文本分段续读 |
| `skill_read(name, path)` | 只读 | 读取技能目录内附带的参考文件、配置文件或脚本资源 |
| `skill_search(query, limit?)` | 只读 | 在技能库的名称、描述与正文中进行全文关键词匹配 |
| `skill_create(name, description, body, ...)` | 写入 | 在本机技能库中新建一个技能规范目录与 SKILL.md 文档 |
| `skill_install(id)` | 写入 | 从在线技能市场中下载并安装技能包 |
| `skill_uninstall(id)` | 写入 | 卸载指定技能并移入回收站 |
| `skill_update(id)` | 写入 | 更新市场已安装技能至最新版本 |

---

## 配置参数速查

在桌面宠物「World 配置 -> 技能库」面板或 `config.json` 的 `worlds.skills` 下可配置以下选项：

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `enabled` | boolean | `true` | 是否启用本地技能库支持 |
| `dirs` | string | 数据目录下技能目录 | 技能扫描根目录（多个用分隔符隔开） |
| `baseDir` | string | `""` | 相对路径基准目录（留空用默认） |
| `promptEnabled` | boolean | `true` | 是否把技能清单注入系统提示词 |
| `maxLoadChars` | number | `4000` | 单次读取技能正文的最大字符数（超出按 `offset` 分段续读） |
| `promptDescChars` | number | 内置值 | 提示词中每个技能描述的截断长度 |
| `marketEnabled` | boolean | `true` | 是否启用在线技能市场 |
| `marketIndexUrl` | string | Anthropic 官方仓库 | 市场索引源（默认指向 `anthropics/skills`） |
| `installDir` | string | 数据目录下技能目录 | 市场安装落盘目录 |
| `maxPackageMb` / `maxFiles` | number | 内置值 | 单个技能包的体积与文件数上限 |
| `allowModelWrite` | boolean | `false` | 是否允许模型主动创建、安装或卸载技能（涉及磁盘写入安全） |
| `allowPrerelease` | boolean | `false` | 市场是否允许安装预发布版本 |
| `autoCheckUpdate` | boolean | `false` | 是否自动检查市场更新 |
| `disabledIds` | string[] | `[]` | 被禁用的技能 id 列表 |

---

## 参考与致谢

本项目为原创实现。下表列明所参考的项目、参考内容及其边界：

| 项目 | 许可 | 我们参考了什么 |
| :--- | :--- | :--- |
| [Anthropic Agent Skills 规范](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md) | 见上游仓库 | `SKILL.md` 目录结构与 YAML 元数据格式（规范遵循，解析器独立编写） |
| [Anthropic 官方技能仓库](https://github.com/anthropics/skills) | 见上游仓库 | 技能市场的默认索引源；仅按需下载技能包，仓库不分发其内容 |

> **边界声明**：本仓库不包含任何第三方项目的源代码或技能包；市场安装的技能内容版权归各自作者，按各自许可使用。若权利人认为有不妥之处，欢迎提 issue 沟通处理。

---

## 许可证

[MIT License](LICENSE) © 2026 HirannU
