// Settings shared by the background worker and the side panel.

export const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

export const DEFAULT_SETTINGS = {
  autoGroup: true,
  focusMode: false, // fold every group in the tab strip except the active tab's
  // { name, match, color }; match is comma-separated pieces looked for in the
  // tab's host + path, e.g. "localhost, 127.0.0.1".
  rules: []
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(changes) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...changes } });
}

export function ruleFor(url, rules) {
  let target;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    target = (u.host + u.pathname).toLowerCase();
  } catch {
    return null;
  }
  return (
    rules.find((rule) =>
      rule.name.trim() &&
      rule.match
        .split(",")
        .map((piece) => piece.trim().toLowerCase())
        .some((piece) => piece && target.includes(piece))
    ) || null
  );
}
