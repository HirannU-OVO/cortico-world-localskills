// src/webui/client.ts
var errText = (err) => err instanceof Error ? err.message : String(err);
var skillsPanel = {
  mount(ctx) {
    const { ui, root, signal } = ctx;
    const msg = ui.msgline();
    const toolbar = ui.rowbar();
    const searchInput = ui.input({ placeholder: "\u641C\u7D22\u672C\u5730\u6280\u80FD (\u540D\u79F0/\u63CF\u8FF0/ID)..." });
    searchInput.style.flex = "1";
    let currentFilter = "all";
    const filterSeg = ui.segmented(
      [
        { value: "all", label: "\u5168\u90E8" },
        { value: "on", label: "\u542F\u7528" },
        { value: "manual", label: "\u4EC5\u624B\u52A8" },
        { value: "off", label: "\u505C\u7528" }
      ],
      {
        value: currentFilter,
        onChange: (val) => {
          currentFilter = val;
          void render();
        }
      }
    );
    const reloadBtn = ui.button("\u27F3 \u5237\u65B0", {
      size: "sm",
      onClick: async () => {
        try {
          await ctx.invoke("reload");
          msg.textContent = "\u6280\u80FD\u5E93\u5DF2\u91CD\u65B0\u626B\u63CF";
          msg.classList.remove("bad");
          void render();
        } catch (e) {
          msg.textContent = `\u5237\u65B0\u5931\u8D25: ${errText(e)}`;
          msg.classList.add("bad");
        }
      }
    });
    toolbar.append(searchInput, filterSeg.el, reloadBtn);
    const listContainer = ui.h("div", "skills-list");
    root.append(msg, toolbar, listContainer);
    let items = [];
    const render = async () => {
      listContainer.innerHTML = "";
      const query = searchInput.value.trim().toLowerCase();
      const filtered = items.filter((s) => {
        if (currentFilter !== "all" && s.state !== currentFilter) return false;
        if (!query) return true;
        return s.id.toLowerCase().includes(query) || s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query);
      });
      if (filtered.length === 0) {
        listContainer.append(ui.placeholder(items.length === 0 ? "\u6682\u65E0\u6280\u80FD" : "\u65E0\u5339\u914D\u6280\u80FD"));
        return;
      }
      for (const skill of filtered) {
        const row = ui.h("div", "sk-row");
        const tone = skill.state === "on" ? "on" : skill.state === "manual" ? "plain" : "off";
        const label = skill.state === "on" ? "\u25CF \u542F\u7528" : skill.state === "manual" ? "\u25D0 \u4EC5\u624B\u52A8" : "\u25CB \u505C\u7528";
        const statePill = ui.pill(label, tone);
        statePill.classList.add("sk-state");
        statePill.title = "\u70B9\u51FB\u5207\u6362\uFF1A\u542F\u7528 \u2192 \u4EC5\u624B\u52A8 \u2192 \u505C\u7528";
        statePill.addEventListener(
          "click",
          async () => {
            const order = ["on", "manual", "off"];
            const next = order[(order.indexOf(skill.state) + 1) % order.length];
            try {
              await ctx.invoke("toggle", [{ id: skill.id, state: next }]);
              skill.state = next;
              void render();
            } catch (err) {
              msg.textContent = `\u5207\u6362\u72B6\u6001\u5931\u8D25: ${errText(err)}`;
              msg.classList.add("bad");
            }
          },
          { signal }
        );
        const name = ui.h("strong", "sk-title", skill.name);
        const metaText = [
          `v${skill.version || "1.0.0"}`,
          skill.source,
          `${skill.lineCount}\u884C`,
          skill.userEdited ? "\u5DF2\u6539" : ""
        ].filter(Boolean).join(" \xB7 ");
        const meta = ui.h("span", "sk-meta", metaText);
        const descText = skill.description || "\u6682\u65E0\u8BF4\u660E";
        const desc = ui.h("span", "sk-desc", descText);
        desc.title = descText;
        const tail = ui.h("div", "sk-tail");
        if (skill.health?.length) {
          const warn = ui.pill("\u26A0", "plain");
          warn.title = skill.health.map((h) => h.message).join("\n");
          tail.append(warn);
        }
        if (skill.source !== "external") {
          const delBtn = ui.button("\u5220\u9664", {
            variant: "danger",
            size: "sm",
            onClick: async () => {
              if (confirm(`\u786E\u5B9A\u8981\u5C06\u6280\u80FD\u300C${skill.name}\u300D\u79FB\u5165\u56DE\u6536\u7AD9\u5417\uFF1F`)) {
                try {
                  await ctx.invoke("remove", [{ id: skill.id }]);
                  msg.textContent = `\u6280\u80FD\u300C${skill.name}\u300D\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9`;
                  msg.classList.remove("bad");
                  await loadData();
                } catch (err) {
                  msg.textContent = `\u5220\u9664\u5931\u8D25: ${errText(err)}`;
                  msg.classList.add("bad");
                }
              }
            }
          });
          tail.append(delBtn);
        }
        row.append(statePill, name, meta, desc, tail);
        listContainer.append(row);
      }
    };
    const loadData = async () => {
      try {
        items = await ctx.invoke("list", [{ query: "", filter: "all" }]) || [];
        await render();
      } catch (err) {
        msg.textContent = `\u52A0\u8F7D\u6280\u80FD\u5217\u8868\u5931\u8D25: ${errText(err)}`;
        msg.classList.add("bad");
      }
    };
    searchInput.addEventListener("input", () => void render(), { signal });
    void loadData();
  },
  unmount() {
  }
};
var marketPanel = {
  mount(ctx) {
    const { ui, root, signal } = ctx;
    const msg = ui.msgline();
    const toolbar = ui.rowbar();
    const searchInput = ui.input({ placeholder: "\u641C\u7D22\u6280\u80FD (\u9884\u7F6E\u63A8\u8350/\u672C\u5730/\u8FDC\u7AEF)..." });
    searchInput.style.flex = "1";
    const refreshBtn = ui.button("\u27F3 \u5237\u65B0\u6E90", {
      size: "sm",
      onClick: async () => {
        try {
          msg.textContent = "\u6B63\u5728\u5237\u65B0\u6280\u80FD\u5E02\u573A\u7D22\u5F15...";
          msg.classList.remove("bad");
          await ctx.invoke("refresh");
          msg.textContent = "\u5E02\u573A\u7D22\u5F15\u5DF2\u66F4\u65B0";
          void loadMarket();
        } catch (err) {
          msg.textContent = `\u5237\u65B0\u5931\u8D25: ${errText(err)}`;
          msg.classList.add("bad");
        }
      }
    });
    toolbar.append(searchInput, refreshBtn);
    const listContainer = ui.h("div", "market-list");
    root.append(msg, toolbar, listContainer);
    let marketItems = [];
    const render = () => {
      listContainer.innerHTML = "";
      const query = searchInput.value.trim().toLowerCase();
      const filtered = marketItems.filter((item) => {
        if (!query) return true;
        return item.id.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
      });
      if (filtered.length === 0) {
        listContainer.append(ui.placeholder(marketItems.length === 0 ? "\u6280\u80FD\u5E02\u573A\u6682\u65E0\u5185\u5BB9" : "\u672A\u627E\u5230\u5339\u914D\u7684\u5E02\u573A\u6280\u80FD"));
        return;
      }
      for (const item of filtered) {
        const row = ui.h("div", "mk-row");
        const name = ui.h("strong", "mk-title", item.displayName || item.id);
        const metaText = [
          `v${item.version}`,
          item.author ? `@${item.author}` : "",
          item.bytes ? `${Math.round(item.bytes / 1024)} KB` : "",
          item.installed ? `\u5DF2\u88C5 v${item.localVersion || item.version}` : ""
        ].filter(Boolean).join(" \xB7 ");
        const meta = ui.h("span", "mk-meta", metaText);
        const descText = item.description || "\u6682\u65E0\u8BF4\u660E";
        const desc = ui.h("span", "mk-desc", descText);
        desc.title = descText;
        const tail = ui.h("div", "mk-tail");
        if (item.hasUpdate) {
          const updateBtn = ui.button(`\u66F4\u65B0 v${item.version}`, {
            variant: "primary",
            size: "sm",
            onClick: async () => {
              updateBtn.disabled = true;
              msg.textContent = `\u6B63\u5728\u66F4\u65B0\u300C${item.displayName}\u300D...`;
              msg.classList.remove("bad");
              try {
                await ctx.invoke("update", [{ id: item.id }]);
                msg.textContent = `\u300C${item.displayName}\u300D\u66F4\u65B0\u6210\u529F\uFF01`;
                await loadMarket();
              } catch (e) {
                msg.textContent = `\u66F4\u65B0\u5931\u8D25: ${errText(e)}`;
                msg.classList.add("bad");
                updateBtn.disabled = false;
              }
            }
          });
          tail.append(updateBtn);
        } else if (item.installed) {
          tail.append(ui.pill(`\u2713 \u5DF2\u5B89\u88C5 v${item.localVersion || item.version}`, "on"));
        } else if (item.conflict) {
          const conflictPill = ui.pill("\u540D\u79F0\u51B2\u7A81", "plain");
          conflictPill.title = "\u672C\u5730\u5DF2\u6709\u540C\u540D\u6280\u80FD\uFF0C\u4F46\u4E0D\u662F\u4ECE\u5E02\u573A\u5B89\u88C5\u7684\u3002\u4E3A\u514D\u8986\u76D6\u4E0D\u4F1A\u81EA\u52A8\u5B89\u88C5\uFF1B\u8981\u7528\u5E02\u573A\u7248\u8BF7\u5148\u5220\u6389\u672C\u5730\u90A3\u4E2A";
          tail.append(conflictPill);
        } else {
          const installBtn = ui.button("\u5B89\u88C5", {
            variant: "primary",
            size: "sm",
            onClick: async () => {
              installBtn.disabled = true;
              msg.textContent = `\u6B63\u5728\u5B89\u88C5\u300C${item.displayName}\u300D...`;
              msg.classList.remove("bad");
              try {
                await ctx.invoke("install", [{ id: item.id }]);
                msg.textContent = `\u300C${item.displayName}\u300D\u5B89\u88C5\u6210\u529F\uFF01`;
                await loadMarket();
              } catch (e) {
                msg.textContent = `\u5B89\u88C5\u5931\u8D25: ${errText(e)}`;
                msg.classList.add("bad");
                installBtn.disabled = false;
              }
            }
          });
          tail.append(installBtn);
        }
        row.append(name, meta, desc, tail);
        listContainer.append(row);
      }
    };
    const loadMarket = async () => {
      try {
        const res = await ctx.invoke("search", [{ query: "" }]);
        marketItems = res?.items || [];
        if (res?.error) {
          msg.textContent = res.error;
          msg.classList.add("bad");
        }
        render();
      } catch (err) {
        msg.textContent = `\u62C9\u53D6\u5E02\u573A\u7D22\u5F15\u5931\u8D25: ${errText(err)}`;
        msg.classList.add("bad");
      }
    };
    searchInput.addEventListener("input", () => void render(), { signal });
    void loadMarket();
  },
  unmount() {
  }
};
var bundle = {
  panels: {
    skills: skillsPanel,
    market: marketPanel
  }
};
var client_default = bundle;
export {
  client_default as default
};
