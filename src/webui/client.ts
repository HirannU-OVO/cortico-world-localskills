/**
 * 技能库前端客户端 bundle 脚本
 * 严格遵照 @wocwang/cortico-world-gpt-sovits-for-coopanion 标准规范：
 * 1. 使用 WebUiClientBundle 接口规范导出 default bundle
 * 2. 完全使用宿主注入的 ctx.ui 轻量原语（rowbar, section, button, pill, msgline, segmented, input 等）
 * 3. 绝不弹独立窗口、不引入第三方笨重组件，完全内嵌于桌宠当前设置页内
 */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import './style.css';

interface SkillListItem {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  state: 'on' | 'manual' | 'off';
  lineCount: number;
  charCount: number;
  health?: Array<{ message: string; level: 'warn' | 'error' }>;
  userEdited?: boolean;
}

interface MarketListItem {
  id: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  bytes?: number;
  installed?: boolean;
  /** 本地有同名技能但不是从市场同一来源安装的，不自动覆盖 */
  conflict?: boolean;
  localVersion?: string;
  hasUpdate?: boolean;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const skillsPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui, root, signal } = ctx;
    const msg = ui.msgline();

    // 顶部工具栏
    const toolbar = ui.rowbar();
    const searchInput = ui.input({ placeholder: '搜索本地技能 (名称/描述/ID)...' });
    searchInput.style.flex = '1';

    let currentFilter: 'all' | 'on' | 'manual' | 'off' = 'all';
    const filterSeg = ui.segmented(
      [
        { value: 'all', label: '全部' },
        { value: 'on', label: '启用' },
        { value: 'manual', label: '仅手动' },
        { value: 'off', label: '停用' },
      ],
      {
        value: currentFilter,
        onChange: (val) => {
          currentFilter = val as any;
          void render();
        },
      }
    );

    const reloadBtn = ui.button('⟳ 刷新', {
      size: 'sm',
      onClick: async () => {
        try {
          await ctx.invoke('reload');
          msg.textContent = '技能库已重新扫描';
          msg.classList.remove('bad');
          void render();
        } catch (e) {
          msg.textContent = `刷新失败: ${errText(e)}`;
          msg.classList.add('bad');
        }
      },
    });

    toolbar.append(searchInput, filterSeg.el, reloadBtn);

    // 技能列表容器
    const listContainer = ui.h('div', 'skills-list');

    root.append(msg, toolbar, listContainer);

    let items: SkillListItem[] = [];

    const render = async () => {
      listContainer.innerHTML = '';
      const query = searchInput.value.trim().toLowerCase();

      const filtered = items.filter((s) => {
        if (currentFilter !== 'all' && s.state !== currentFilter) return false;
        if (!query) return true;
        return (
          s.id.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query)
        );
      });

      if (filtered.length === 0) {
        listContainer.append(ui.placeholder(items.length === 0 ? '暂无技能' : '无匹配技能'));
        return;
      }

      for (const skill of filtered) {
        const row = ui.h('div', 'sk-row');

        // 状态胶囊：点一下循环 启用 → 仅手动 → 停用
        const tone = skill.state === 'on' ? 'on' : skill.state === 'manual' ? 'plain' : 'off';
        const label = skill.state === 'on' ? '● 启用' : skill.state === 'manual' ? '◐ 仅手动' : '○ 停用';
        const statePill = ui.pill(label, tone);
        statePill.classList.add('sk-state');
        statePill.title = '点击切换：启用 → 仅手动 → 停用';
        statePill.addEventListener(
          'click',
          async () => {
            const order: Array<'on' | 'manual' | 'off'> = ['on', 'manual', 'off'];
            const next = order[(order.indexOf(skill.state) + 1) % order.length];
            try {
              await ctx.invoke('toggle', [{ id: skill.id, state: next }]);
              skill.state = next;
              void render();
            } catch (err) {
              msg.textContent = `切换状态失败: ${errText(err)}`;
              msg.classList.add('bad');
            }
          },
          { signal }
        );

        const name = ui.h('strong', 'sk-title', skill.name);
        const metaText = [
          `v${skill.version || '1.0.0'}`,
          skill.source,
          `${skill.lineCount}行`,
          skill.userEdited ? '已改' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const meta = ui.h('span', 'sk-meta', metaText);

        const descText = skill.description || '暂无说明';
        const desc = ui.h('span', 'sk-desc', descText);
        desc.title = descText;

        const tail = ui.h('div', 'sk-tail');
        if (skill.health?.length) {
          const warn = ui.pill('⚠', 'plain');
          warn.title = skill.health.map((h) => h.message).join('\n');
          tail.append(warn);
        }
        if (skill.source !== 'external') {
          const delBtn = ui.button('删除', {
            variant: 'danger',
            size: 'sm',
            onClick: async () => {
              if (confirm(`确定要将技能「${skill.name}」移入回收站吗？`)) {
                try {
                  await ctx.invoke('remove', [{ id: skill.id }]);
                  msg.textContent = `技能「${skill.name}」已移入回收站`;
                  msg.classList.remove('bad');
                  await loadData();
                } catch (err) {
                  msg.textContent = `删除失败: ${errText(err)}`;
                  msg.classList.add('bad');
                }
              }
            },
          });
          tail.append(delBtn);
        }

        row.append(statePill, name, meta, desc, tail);
        listContainer.append(row);
      }
    };

    const loadData = async () => {
      try {
        items = (await ctx.invoke<SkillListItem[]>('list', [{ query: '', filter: 'all' }])) || [];
        await render();
      } catch (err) {
        msg.textContent = `加载技能列表失败: ${errText(err)}`;
        msg.classList.add('bad');
      }
    };

    searchInput.addEventListener('input', () => void render(), { signal });

    void loadData();
  },
  unmount() {},
};

const marketPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui, root, signal } = ctx;
    const msg = ui.msgline();

    const toolbar = ui.rowbar();
    const searchInput = ui.input({ placeholder: '搜索技能 (预置推荐/本地/远端)...' });
    searchInput.style.flex = '1';

    const refreshBtn = ui.button('⟳ 刷新源', {
      size: 'sm',
      onClick: async () => {
        try {
          msg.textContent = '正在刷新技能市场索引...';
          msg.classList.remove('bad');
          await ctx.invoke('refresh');
          msg.textContent = '市场索引已更新';
          void loadMarket();
        } catch (err) {
          msg.textContent = `刷新失败: ${errText(err)}`;
          msg.classList.add('bad');
        }
      },
    });

    toolbar.append(searchInput, refreshBtn);

    const listContainer = ui.h('div', 'market-list');
    root.append(msg, toolbar, listContainer);

    let marketItems: MarketListItem[] = [];

    const render = () => {
      listContainer.innerHTML = '';
      const query = searchInput.value.trim().toLowerCase();

      const filtered = marketItems.filter((item) => {
        if (!query) return true;
        return (
          item.id.toLowerCase().includes(query) ||
          item.displayName.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query)
        );
      });

      if (filtered.length === 0) {
        listContainer.append(ui.placeholder(marketItems.length === 0 ? '技能市场暂无内容' : '未找到匹配的市场技能'));
        return;
      }

      for (const item of filtered) {
        const row = ui.h('div', 'mk-row');
        const name = ui.h('strong', 'mk-title', item.displayName || item.id);

        const metaText = [
          `v${item.version}`,
          item.author ? `@${item.author}` : '',
          item.bytes ? `${Math.round(item.bytes / 1024)} KB` : '',
          item.installed ? `已装 v${item.localVersion || item.version}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const meta = ui.h('span', 'mk-meta', metaText);

        const descText = item.description || '暂无说明';
        const desc = ui.h('span', 'mk-desc', descText);
        desc.title = descText;

        const tail = ui.h('div', 'mk-tail');
        if (item.hasUpdate) {
          const updateBtn = ui.button(`更新 v${item.version}`, {
            variant: 'primary',
            size: 'sm',
            onClick: async () => {
              updateBtn.disabled = true;
              msg.textContent = `正在更新「${item.displayName}」...`;
              msg.classList.remove('bad');
              try {
                await ctx.invoke('update', [{ id: item.id }]);
                msg.textContent = `「${item.displayName}」更新成功！`;
                await loadMarket();
              } catch (e) {
                msg.textContent = `更新失败: ${errText(e)}`;
                msg.classList.add('bad');
                updateBtn.disabled = false;
              }
            },
          });
          tail.append(updateBtn);
        } else if (item.installed) {
          tail.append(ui.pill(`✓ 已安装 v${item.localVersion || item.version}`, 'on'));
        } else if (item.conflict) {
          const conflictPill = ui.pill('名称冲突', 'plain');
          conflictPill.title = '本地已有同名技能，但不是从市场安装的。为免覆盖不会自动安装；要用市场版请先删掉本地那个';
          tail.append(conflictPill);
        } else {
          const installBtn = ui.button('安装', {
            variant: 'primary',
            size: 'sm',
            onClick: async () => {
              installBtn.disabled = true;
              msg.textContent = `正在安装「${item.displayName}」...`;
              msg.classList.remove('bad');
              try {
                await ctx.invoke('install', [{ id: item.id }]);
                msg.textContent = `「${item.displayName}」安装成功！`;
                await loadMarket();
              } catch (e) {
                msg.textContent = `安装失败: ${errText(e)}`;
                msg.classList.add('bad');
                installBtn.disabled = false;
              }
            },
          });
          tail.append(installBtn);
        }

        row.append(name, meta, desc, tail);
        listContainer.append(row);
      }
    };

    const loadMarket = async () => {
      try {
        const res = await ctx.invoke<{ items: MarketListItem[]; fromCache?: boolean; error?: string }>('search', [{ query: '' }]);
        marketItems = res?.items || [];
        if (res?.error) {
          msg.textContent = res.error;
          msg.classList.add('bad');
        }
        render();
      } catch (err) {
        msg.textContent = `拉取市场索引失败: ${errText(err)}`;
        msg.classList.add('bad');
      }
    };

    searchInput.addEventListener('input', () => void render(), { signal });

    void loadMarket();
  },
  unmount() {},
};

const bundle: WebUiClientBundle = {
  panels: {
    skills: skillsPanel,
    market: marketPanel,
  },
};

export default bundle;
