import { COLORS, getSettings, saveSettings } from "./settings.js";

const NO_GROUP = -1;
const PINNED = { id: "pinned", title: "Pinned", color: "grey" };

const $ = (sel) => document.querySelector(sel);
let windowId;
let expanded = {}; // group name → open in the panel (remembered across restarts)
let renderTimer = null;

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...[].concat(children));
  return node;
}

function button(label, title, onClick) {
  return h("button", {
    title,
    onclick: (e) => {
      e.stopPropagation();
      onClick(e);
    }
  }, label);
}

// Chrome's own favicon cache; works for sleeping and parked tabs too.
function favicon(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl || "");
  url.searchParams.set("size", "16");
  return url.toString();
}

function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

function setExpanded(key, open) {
  expanded[key] = open;
  chrome.storage.local.set({ expanded });
}

// Sends a task to the background worker; a failure is shown under the header.
async function ask(msg) {
  const response = await chrome.runtime.sendMessage(msg).catch((err) => ({ ok: false, error: String(err) }));
  const status = $("#status");
  status.hidden = response?.ok !== false;
  status.textContent = response?.ok === false ? `Chrome refused: ${response.error}` : "";
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 60);
}

function sleep(tabs) {
  for (const tab of tabs) {
    if (!tab.active && !tab.discarded) chrome.tabs.discard(tab.id).catch(() => {});
  }
}

function tabRow(tab) {
  return h("div", {
    class: `tab${tab.active ? " active" : ""}${tab.discarded ? " asleep" : ""}`,
    title: `${tab.title}\n${tab.url}${tab.discarded ? "\n(asleep)" : ""}`,
    onclick: () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    }
  }, [
    h("img", { src: favicon(tab.url), alt: "" }),
    h("span", { class: "title" }, tab.title || tab.url),
    Object.assign(button("✕", "Close tab", () => chrome.tabs.remove(tab.id)), { className: "close" })
  ]);
}

function groupBlock(group, tabs, searching) {
  const key = group.title || `#${group.id}`;
  const open = searching || (expanded[key] ?? tabs.some((t) => t.active));
  const asleep = tabs.filter((t) => t.discarded).length;
  const block = h("div", { class: `group${open ? " open" : ""}`, style: `--c: var(--${group.color})` });

  const actions = group === PINNED ? [] : [
    button("💤", "Sleep this group's tabs (frees memory, keeps the tabs)", () => sleep(tabs)),
    button("📦", "Park: close these tabs and keep them in the Parked list", () =>
      ask({ type: "park", groupId: group.id })
    ),
    button(group.collapsed ? "Unfold" : "Fold", "Fold or unfold this group in the tab strip", () =>
      ask({ type: "fold", groupId: group.id, collapsed: !group.collapsed })
    )
  ];

  block.append(
    h("div", {
      class: "group-head",
      onclick: () => setExpanded(key, block.classList.toggle("open"))
    }, [
      h("span", { class: "caret" }, "▸"),
      h("span", { class: "dot" }),
      h("span", { class: "group-title" }, group.title || "Unnamed group"),
      h("span", { class: "count" }, `${tabs.length}${asleep ? ` · ${asleep} 💤` : ""}`),
      ...actions
    ]),
    h("div", { class: "group-tabs" }, tabs.map(tabRow))
  );
  return block;
}

function parkedBlock(entry, tabs, searching) {
  const key = `parked:${entry.id}`;
  const block = h("div", {
    class: `group${searching || expanded[key] ? " open" : ""}`,
    style: `--c: var(--${entry.color})`
  });

  const update = async (change) => {
    const { parked = [] } = await chrome.storage.local.get("parked");
    await chrome.storage.local.set({ parked: change(parked) });
  };

  // Two clicks to delete, so a saved list isn't lost by a stray click.
  const remove = button("✕", "Forget this parked group", (e) => {
    if (e.target.dataset.armed) update((parked) => parked.filter((p) => p.id !== entry.id));
    else {
      e.target.dataset.armed = "1";
      e.target.textContent = "Delete?";
    }
  });

  // Opening one tab from a parked group takes it out of the group.
  const openOne = (t) => {
    chrome.tabs.create({ windowId, url: t.url });
    update((parked) =>
      parked
        .map((p) => (p.id === entry.id ? { ...p, tabs: p.tabs.filter((x) => x.url !== t.url) } : p))
        .filter((p) => p.tabs.length)
    );
  };

  block.append(
    h("div", { class: "group-head", onclick: () => setExpanded(key, block.classList.toggle("open")) }, [
      h("span", { class: "caret" }, "▸"),
      h("span", { class: "dot" }),
      h("span", { class: "group-title" }, entry.title),
      h("span", { class: "count" }, `${entry.tabs.length} · ${ago(entry.parkedAt)}`),
      button("Restore", "Reopen these tabs as a group", () => ask({ type: "restore", id: entry.id, windowId })),
      remove
    ]),
    h("div", { class: "group-tabs" }, tabs.map((t) =>
      h("div", { class: "tab", title: `${t.title}\n${t.url}\n(click to reopen)`, onclick: () => openOne(t) }, [
        h("img", { src: favicon(t.url), alt: "" }),
        h("span", { class: "title" }, t.title || t.url)
      ])
    ))
  );
  return block;
}

async function render() {
  const [tabs, groups, { parked = [] }] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    chrome.storage.local.get("parked")
  ]);
  const words = $("#search").value.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const matches = (t) => words.every((w) => `${t.title} ${t.url}`.toLowerCase().includes(w));

  // Same order as the tab strip: pinned tabs, then groups and loose tabs as they appear.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const blocks = [];
  const blockByKey = new Map();
  for (const tab of tabs) {
    if (!matches(tab)) continue;
    const key = tab.pinned ? "pinned" : tab.groupId !== NO_GROUP ? tab.groupId : null;
    if (key === null) {
      blocks.push(tabRow(tab));
      continue;
    }
    if (!blockByKey.has(key)) {
      const block = { group: key === "pinned" ? PINNED : groupById.get(key), tabs: [] };
      blockByKey.set(key, block);
      blocks.push(block);
    }
    blockByKey.get(key).tabs.push(tab);
  }
  $("#list").replaceChildren(
    ...blocks.map((b) => (b instanceof Node ? b : groupBlock(b.group, b.tabs, searching))),
    ...(blocks.length ? [] : [h("div", { class: "empty muted" }, "No tabs match.")])
  );

  const parkedBlocks = parked
    .map((entry) => ({ entry, tabs: entry.tabs.filter(matches) }))
    .filter((p) => p.tabs.length)
    .map((p) => parkedBlock(p.entry, p.tabs, searching));
  $("#parked").replaceChildren(...parkedBlocks);
  $("#parked-section").hidden = !parkedBlocks.length;

  const asleep = tabs.filter((t) => t.discarded).length;
  $("#stats").textContent = `${tabs.length} tabs · ${asleep} asleep · ${groups.length} groups`;
}

// Settings

async function renderSettings() {
  const settings = await getSettings();
  $("#auto-group").checked = settings.autoGroup;
  $("#focus-mode").checked = settings.focusMode;

  const rules = settings.rules.map((r) => ({ ...r }));
  const save = () => saveSettings({ rules });
  $("#rules").replaceChildren(
    ...rules.map((rule, i) => {
      const field = (prop, props) =>
        h("input", { ...props, value: rule[prop], onchange: (e) => { rule[prop] = e.target.value.trim(); save(); } });
      const color = h("select", { onchange: (e) => { rule.color = e.target.value; save(); } },
        COLORS.map((c) => h("option", { value: c }, c))
      );
      color.value = rule.color;
      return h("div", { class: "rule", style: `--c: var(--${rule.color})` }, [
        field("name", { placeholder: "Group name" }),
        field("match", { placeholder: "e.g. gitlab, jira" }),
        color,
        button("✕", "Delete rule", async () => {
          rules.splice(i, 1);
          await save();
          renderSettings();
        })
      ]);
    }),
    ...(rules.length ? [] : [h("p", { class: "muted" }, "No rules yet. Add one to start grouping tabs automatically.")])
  );
}

async function init() {
  windowId = (await chrome.windows.getCurrent()).id;
  ({ expanded = {} } = await chrome.storage.local.get("expanded"));

  $("#search").addEventListener("input", scheduleRender);
  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = "";
      render();
    }
  });
  $("#sleep-all").addEventListener("click", async () => sleep(await chrome.tabs.query({ windowId })));
  $("#toggle-settings").addEventListener("click", () => {
    const section = $("#settings");
    section.hidden = !section.hidden;
    if (!section.hidden) renderSettings();
  });
  $("#auto-group").addEventListener("change", (e) => saveSettings({ autoGroup: e.target.checked }));
  $("#fold-all").addEventListener("click", () => ask({ type: "foldAll", windowId }));
  $("#focus-mode").addEventListener("change", async (e) => {
    await saveSettings({ focusMode: e.target.checked });
    if (e.target.checked) ask({ type: "foldOthers", windowId });
  });
  $("#add-rule").addEventListener("click", async () => {
    const { rules } = await getSettings();
    await saveSettings({ rules: [...rules, { name: "", match: "", color: COLORS[rules.length % COLORS.length] }] });
    await renderSettings();
    $("#rules .rule:last-child input")?.focus();
  });
  $("#group-now").addEventListener("click", () => ask({ type: "groupAll", windowId }));

  for (const event of ["onCreated", "onRemoved", "onUpdated", "onMoved", "onActivated", "onAttached", "onDetached", "onReplaced"]) {
    chrome.tabs[event].addListener(scheduleRender);
  }
  for (const event of ["onCreated", "onRemoved", "onUpdated", "onMoved"]) {
    chrome.tabGroups[event].addListener(scheduleRender);
  }
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.parked) scheduleRender();
  });

  render();
}

init();
