import { getSettings, ruleFor } from "./settings.js";

const NO_GROUP = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Grouping is done one step at a time, so two tabs loading at once can't
// both create a "GitLab" group.
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch((err) => console.warn("Tab Groups Panel:", err));
  return result;
}

// While a tab is being clicked or dragged in the tab strip, Chrome rejects tab
// edits with "Tabs cannot be edited right now", so those are retried for a while.
async function edit(change) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await change();
    } catch (err) {
      if (attempt >= 15 || !/cannot be edited right now/i.test(err?.message)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

async function findGroup(windowId, title) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((g) => g.title === title) || null;
}

async function addToGroup(windowId, tabIds, title, color) {
  const existing = await findGroup(windowId, title);
  if (existing) return edit(() => chrome.tabs.group({ groupId: existing.id, tabIds }));
  const groupId = await edit(() => chrome.tabs.group({ tabIds, createProperties: { windowId } }));
  await edit(() => chrome.tabGroups.update(groupId, { title, color }));
  return groupId;
}

// Moves an ungrouped tab into its rule's group. Tabs already in a group stay
// there whatever their address: a tab opened from a grouped tab is put in that
// group by Chrome, and keeps it. Only new tabs (Cmd+T, links from other apps)
// and other loose tabs are sorted by the rules.
async function placeTab(tabId, rules) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.pinned || tab.groupId !== NO_GROUP) return;
  const rule = ruleFor(tab.url || tab.pendingUrl || "", rules);
  if (rule) await addToGroup(tab.windowId, [tab.id], rule.name, rule.color);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  const settings = await getSettings();
  if (!settings.autoGroup) return;
  enqueue(async () => {
    await placeTab(tabId, settings.rules);
    if (settings.focusMode) await foldOthers(tab.windowId);
  });
});

async function setCollapsed(groupId, collapsed) {
  await edit(() => chrome.tabGroups.update(groupId, { collapsed }));
}

// Fold mode: only the active tab's group stays unfolded in the tab strip.
async function foldOthers(windowId) {
  const [active] = await chrome.tabs.query({ windowId, active: true });
  for (const group of await chrome.tabGroups.query({ windowId })) {
    const collapsed = group.id !== active?.groupId;
    if (group.collapsed !== collapsed) await setCollapsed(group.id, collapsed);
  }
}

// Folds every group except the active tab's (Chrome won't hide the tab you're on).
async function foldAll(windowId) {
  const [active] = await chrome.tabs.query({ windowId, active: true });
  for (const group of await chrome.tabGroups.query({ windowId })) {
    if (!group.collapsed && group.id !== active?.groupId) await setCollapsed(group.id, true);
  }
}

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  const settings = await getSettings();
  if (settings.focusMode) enqueue(() => foldOthers(windowId));
});

async function groupAll(windowId) {
  const { rules } = await getSettings();
  for (const tab of await chrome.tabs.query({ windowId })) await placeTab(tab.id, rules);
}

// Park: remember the group's tabs, then close them.
async function park(groupId) {
  const group = await chrome.tabGroups.get(groupId);
  const tabs = await chrome.tabs.query({ groupId });
  const { parked = [] } = await chrome.storage.local.get("parked");
  parked.unshift({
    id: `${Date.now()}`,
    title: group.title || "Unnamed group",
    color: group.color,
    parkedAt: Date.now(),
    tabs: tabs.map((t) => ({ url: t.url || t.pendingUrl, title: t.title }))
  });
  await chrome.storage.local.set({ parked });
  await edit(() => chrome.tabs.remove(tabs.map((t) => t.id)));
}

// Restore: reopen the tabs (in the background) into a group of the same name.
async function restore(id, windowId) {
  const { parked = [] } = await chrome.storage.local.get("parked");
  const entry = parked.find((p) => p.id === id);
  if (!entry) return;
  const tabIds = [];
  for (const t of entry.tabs) {
    tabIds.push((await chrome.tabs.create({ windowId, url: t.url, active: false })).id);
  }
  if (tabIds.length) await addToGroup(windowId, tabIds, entry.title, entry.color);
  await chrome.storage.local.set({ parked: parked.filter((p) => p.id !== id) });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const tasks = {
    groupAll: () => groupAll(msg.windowId),
    park: () => park(msg.groupId),
    restore: () => restore(msg.id, msg.windowId),
    fold: () => setCollapsed(msg.groupId, msg.collapsed),
    foldAll: () => foldAll(msg.windowId),
    foldOthers: () => foldOthers(msg.windowId)
  };
  if (!tasks[msg.type]) return false;
  enqueue(tasks[msg.type]).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String(err) })
  );
  return true; // response is sent asynchronously
});
