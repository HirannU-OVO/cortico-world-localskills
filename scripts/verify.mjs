// 技能库插件的本地验证脚本：模拟 WorldContext 跑一遍扫描与三个工具。
// 用法：node scripts/verify.mjs [dataDir]
// 默认把 dataDir 指到生产环境的 companion/data，用真实技能目录验证。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 数据目录：优先命令行参数，其次环境变量 COOPANION_DATA_DIR，最后回退到当前目录下的 data/
const DEFAULT_DATA_DIR = process.env.COOPANION_DATA_DIR || resolve(process.cwd(), 'data');
const dataDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DATA_DIR;

const mod = await import(new URL('../src/index.ts', import.meta.url).href);

const world = mod.create({ cfg: { enabled: true, dirs: 'skills', baseDir: '', promptEnabled: true, maxLoadChars: 12000 }, dataDir });
const logs = [];
const host = {
  log: {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  },
};

await world.start(host);

const [listTool, loadTool, readTool] = world.tools();

const list = await listTool.handler({});
console.log('=== skill_list ===');
console.log(list);

const loaded = await loadTool.handler({ name: 'git-commit' });
console.log('\n=== skill_load(git-commit) 前 400 字 ===');
console.log(String(loaded).slice(0, 400));

const res = await readTool.handler({ name: 'agent-browser', path: 'references/commands.md' });
console.log('\n=== skill_read(agent-browser, references/commands.md) 前 200 字 ===');
console.log(String(res).slice(0, 200));

const escape = await readTool.handler({ name: 'git-commit', path: '../../config.json' });
console.log('\n=== 越界防护测试 ===');
console.log(String(escape).slice(0, 120));

const env = world.envPromptVars();
console.log('\n=== envPromptVars ===');
console.log('skillCount =', env?.skillCount);
console.log('skillDirs  =', env?.skillDirs);

console.log('\n=== 日志 ===');
for (const line of logs) console.log(line.join(' '));

await world.stop();
