/**
 * 技能健康检查
 * 诊断 frontmatter 语法、缺失 SKILL.md、重名冲突、正文超限、路径逃逸等问题
 */
import type { HealthIssue, Skill } from '../types.ts';

export function checkSkillHealth(skill: Skill, allSkills: Skill[]): HealthIssue[] {
  const issues: HealthIssue[] = [...skill.health];

  // 1. 检查重名冲突
  const sameName = allSkills.filter((s) => s.id === skill.id || s.name.toLowerCase() === skill.name.toLowerCase());
  if (sameName.length > 1) {
    issues.push({
      type: 'name-conflict',
      message: `存在同名技能（${sameName.map((s) => s.dir).join(', ')}），当前生效的是优先扫描到的版本`,
      level: 'warn',
    });
  }

  // 2. 超大文件提示
  if (skill.charCount > 50000) {
    issues.push({
      type: 'oversized',
      message: `技能正文较大 (${skill.charCount} 字符 / ${skill.lineCount} 行)，模型单次读取时将依赖分段加载`,
      level: 'warn',
    });
  }

  return issues;
}
