# Tab Groups Panel

A Chrome extension for people who keep a lot of tabs open. It adds a side panel that lists
the window's tabs by group with their full titles, so the tab strip can stay folded. Groups
can fill themselves from address rules, and whole groups can be put to sleep or parked to
save memory.

It only uses the `tabs`, `tabGroups`, `sidePanel`, `storage` and `favicon` permissions. It
never reads page contents and sends nothing anywhere; settings stay in the browser.

## Install
1. Download this repository (**Code → Download ZIP** and unzip it, or `git clone` it).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the folder.

Install it in each Chrome profile you use; every profile keeps its own rules and parked
groups. Open the panel with the toolbar icon (pin it from the puzzle-piece menu) or
**Alt+Shift+T** (change it at `chrome://extensions/shortcuts`).

To update, pull or download the new version and click the reload icon on the extension's
card in `chrome://extensions`.

## Features
- **Panel list**: pinned tabs, groups and loose tabs in tab-strip order. Click a group to
  expand it, click a tab to switch to it, ✕ closes it. Sleeping tabs are dimmed. The group
  with the active tab starts expanded; other groups remember whether you left them open.
- **Search**: filters tabs and parked tabs by title and address (Esc clears).
- **Per group** (on hover): 💤 sleeps its tabs (they stay open but stop using memory until
  clicked), 📦 parks it (closes the tabs and keeps them under **Parked**), Fold/Unfold folds
  it in the tab strip.
- **Parked**: Restore reopens all tabs into a group of the same name (in the background).
  Clicking a single parked tab reopens just that one and removes it from the list. ✕ twice
  forgets the parked group.
- **Fold all**: folds every group in the tab strip except the one with the tab you're on.
- **💤 Sleep all**: sleeps every tab in the window except the active one.
- **Fold mode** (⚙): keeps every group folded in the tab strip except the active tab's.
- If Chrome refuses an action, the reason is shown in red under the header.

## Auto-grouping rules
There are no rules out of the box. Add them under ⚙ → **Rules**: a group name, the text to
look for in the address (host + path, several pieces separated by commas) and a color.
For example:

| Group name | Match | Catches |
|---|---|---|
| Local | `localhost, 127.0.0.1` | local development servers on any port |
| Docs | `docs.google.com` | Google Docs, Sheets and Slides |
| Code | `github.com, gitlab.com` | repositories and merge requests |

How tabs are placed:
- A tab that isn't in a group (a new tab, a link opened from another app) joins the group
  of the first matching rule in its window, which is created if needed.
- A tab already in a group is never moved: a tab opened from a grouped tab stays in that
  group even if another rule matches its address.
- Pinned tabs and tabs no rule matches are left alone.
- **Group open tabs now** applies the rules to the loose tabs already open.

Group names are matched exactly (including capitals), so to feed groups you made yourself,
give the rule the same name.

Chrome's own **Memory Saver** (Settings → Performance) also sleeps tabs that have been idle
for a while; the two work together.

## Files
- `background.js`: auto-grouping, fold mode, park and restore. Changes to groups run one at a
  time through a queue so tabs loading together don't create duplicate groups, and edits
  Chrome rejects while a tab is being clicked or dragged are retried.
- `settings.js`: settings storage and rule matching (shared).
- `sidepanel.html/.css/.js`: the panel.

## License
MIT, see [LICENSE](LICENSE).
