<div align="center">

<img src="kiro-logo.png" alt="Kiro logo" width="96" height="96">

# Kiro

**Your external mind.**

Write in Markdown, link your ideas, plan your day and map it all out.<br>
Offline, free, and every note stays in a folder you own.

[![Latest release](https://img.shields.io/github/v/release/GabriellHammes16/kiro?label=release&color=555)](https://github.com/GabriellHammes16/kiro/releases/latest)
![Windows and Linux](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-555)
![Offline first](https://img.shields.io/badge/works-offline-2ea44f)
![Markdown](https://img.shields.io/badge/notes-Markdown-555)
![Electron](https://img.shields.io/badge/electron-44-47848F)
[![License GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[**Download**](https://github.com/GabriellHammes16/kiro/releases/latest) · [What you can do](#what-you-can-do) · [Plug-ins](#plug-ins) · [Privacy](#privacy)

<br>

<img src="docs/images/notes.png" alt="A note in Kiro, with the folder tree on the left" width="100%">

</div>

<table>
  <tr>
    <td width="50%"><img src="docs/images/today.png" alt="Today page with habits, tasks and quick capture"><br><b>Today</b> — habits, what to do now and a quick capture box.</td>
    <td width="50%"><img src="docs/images/flow.png" alt="Flow canvas with linked idea cards"><br><b>Flow</b> — idea maps in the open JSON Canvas format.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/tasks.png" alt="Tasks grouped by date"><br><b>Tasks</b> — by date, month, list or columns; repeat and remind.</td>
    <td width="50%"><img src="docs/images/graph.png" alt="Graph of linked notes"><br><b>Graph</b> — see how your notes connect.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/themes.png" alt="Theme picker with classic and anime themes"><br><b>Themes</b> — classic, Liquid Glass and anime-inspired.</td>
    <td width="50%"><img src="docs/images/penumbra.png" alt="A note with code in the Penumbra theme"><br><b>Penumbra</b> — a soft grey theme for reading at night.</td>
  </tr>
</table>

## Download

Get the latest version from [Releases](https://github.com/GabriellHammes16/kiro/releases/latest).

### Windows

1. Download **`Kiro-X.Y.Z-win.zip`**.
2. Right-click the file → **Extract All…**, and pick a folder of its own that you will keep, such as `Apps\Kiro` inside your user folder. Avoid `Documents\Kiro`: that is where your notes live by default. Do not run Kiro from inside the zip.
3. Open the folder and double-click **`Kiro.exe`**.
4. On the first run, Kiro adds itself to the **Start menu** with its own icon. To pin it, open the Start menu, find **Kiro**, right-click it and choose **Pin to taskbar** (on Windows 11 it may be under **More**).

**To update:** close Kiro, extract the new zip into the same folder (replace the files) and open it again. Your notes are not in that folder, so nothing is lost.

**Why a zip?** Kiro is not code-signed yet (see [Code signing policy](#code-signing-policy)). Windows, and Smart App Control in particular, may block a new unsigned program. The `Kiro.exe` in the zip is the official, unmodified Electron runtime, which Windows already knows, so it usually opens without trouble. In File Explorer the file shows the Electron icon; the window, the Start menu entry and the taskbar show Kiro's.

There is also an installer, `Kiro-Setup-X.Y.Z.exe`. It works the same, but Windows is more likely to warn about it or block it. If you see the blue "Windows protected your PC" screen, click **More info → Run anyway**.

### Linux

- `Kiro-X.Y.Z.deb` for Ubuntu and Debian: `sudo apt install ./Kiro-X.Y.Z.deb`
- `Kiro-X.Y.Z.AppImage` for any distribution: make it executable (`chmod +x Kiro-X.Y.Z.AppImage`) and run it.

## What you can do

### Write and connect

- Write in Markdown. Link notes with `[[Note name]]`, or `[[Note name|other text]]` to show a different label.
- See which notes point to the one you are reading (backlinks), and explore everything in the **Graph**.
- Add tags in the tags field or with `#study` in the text. Search finds titles, text and tags; `#tag` filters by tag.
- Notes save by themselves 3 seconds after you stop typing, and when you leave the window. A note without a title gets its first line as the title.
- **Quick capture** on the Today page creates a note tagged `inbox`.
- **Daily note** opens (or creates) the note for today's date.
- **Templates:** ready-made ones (meeting notes, lesson plan, session log, legal brief outline, script, building site diary, study and daily) and your own. To make your own, open **Quick actions → Create personal template** and save it with the `modelo` tag. In a template, `{{date}}` becomes today's date (`YYYY-MM-DD`) and `{{title}}` the note title.
- **Focus mode** hides the navigation and shows a word goal.
- **History:** open a saved note's history, preview an older version and restore it. The current version is kept too.
- **Print or export to PDF** with the buttons in the editor. Only the note is printed, on a white background.

### Plan your time

- Tasks can repeat every day, week, month or every few days. Finishing one creates the next.
- Reminders can notify you (turn them on in Settings; Kiro must be open).
- **Month** view in Tasks: pick a day to see its tasks or add one.
- Habits and a Today page with cards you can rearrange.

### Images, PDFs and equations

- Paste a screenshot with **Ctrl+V** or drag an image into a note. It is saved in your vault, in `Anexos/`, as `![[Anexos/name.png]]` — the same format as Obsidian. Drag the corner dot to resize it.
- PNG, JPEG, GIF, WebP and PDF up to 250 MB. SVG is not accepted, because it can carry code.
- A PDF in a note, `![[Anexos/book.pdf]]`, shows its pages right inside the note. `#page=12` opens at page 12, and `|700` sets the height. The PDF is drawn by [PDF.js](https://mozilla.github.io/pdf.js/), bundled with Kiro, so nothing is downloaded.
- Equations: `$x^2$` inside a line, or a block between two `$$` lines, drawn by the bundled [KaTeX](https://katex.org). `R$ 5` stays as money: only text right next to the `$` becomes a formula.

### Flow: idea maps

A canvas for mind maps and idea boards. Each flow is a `.canvas` file in the open [JSON Canvas](https://jsoncanvas.org) format, so it also opens in Obsidian. Create one by right-clicking a folder (**New flow here**) or with the flow button above the folder tree.

- **Cards:** Markdown text (with code and formulas), notes from your vault, images, PDFs, text files, tables (`.csv`), audio, video, links and groups.
- Every file card has 3 states: just the title, open inside the card, or full screen with **Open**.
- **Keyboard:** double-click the background to add a card; **Ctrl+Enter** adds the next card and **Ctrl+Shift+Enter** a linked one (you can change these in Settings → Shortcuts); **Ctrl+C / X / V / D / A** copy, cut, paste, duplicate and select all; arrow keys move cards; **Delete** removes; **Ctrl+Z / Ctrl+Y** undo and redo.
- **Mouse:** drag from a card's dot to link it (drop on empty space for a new linked card); **Ctrl+wheel** zooms; **Space+drag** moves the view; **Shift+1** fits everything.
- Cards grow with their text until you resize them by hand, and guide lines help you line them up.
- Paste text, a link or a file to add it. Drag a note from the tree into the flow.
- Link previews and YouTube videos playing in the card are **off by default**: turn them on in Settings → System → Internet in Flow.

### Look and feel

- Many themes, from classic light and dark to Liquid Glass and colourful anime-inspired ones, and skins that change shapes and corners.
- Your own wallpaper, image or video.
- Interface text from 100% to 150%; the graph also has a text list of its links.

### Plug-ins

Four plug-ins come with the desktop app, in **Settings → Plug-ins**. None is turned on until you check its permissions and enable it.

| Plug-in | What it does |
|---|---|
| Focus / Pomodoro | Pick a task or free focus, run 25-minute cycles with 5-minute breaks (adjustable), and see reports by folder and tag. |
| Flashcards | Write `Question :: Answer` in your notes and review them one at a time. |
| Weekly review | See recent notes and open tasks, write your thoughts and save them as a new note. |
| Slides | Turn a note's headings and separators into slides. Arrow keys or Space move; Esc goes back. |

Plug-ins work offline and follow the app's theme. To write your own, see [docs/plugins.md](docs/plugins.md).

### AI assistants (optional)

Kiro has a controlled way for AI assistants to read and write your vault, through an MCP server (`npm run mcp`, over stdio, with no network port). An AI can create and edit notes, tasks and flows — for example, "turn note X into a mind map", including files and attachments. You decide what it may do in **Settings → AI and integrations** (deleting is off by default), and every change is logged in `.kiro/audit.log` inside your vault. Kiro works the same without any AI connected. Details: [docs/agent-api.md](docs/agent-api.md) and [docs/mcp.md](docs/mcp.md).

## Your vault is the source of truth

Your notes are plain `.md` files in a folder you own, so you can open them in any editor, back them up or sync them however you like.

- The default vault on the desktop is `Documents/Kiro/vault`. **Choose another vault** opens another folder (empty or existing) and remembers it. It does not move your files: to move them, copy the whole folder while Kiro is closed.
- Every `.md` file in the folder and its subfolders is loaded. Hidden folders and symbolic links are ignored. Notes created by Kiro go to `Notas/`, with YAML metadata and a permanent ID.
- `caderno.json` keeps only tasks, habits and study folders, never copies of your notes. Your own YAML fields are kept when you edit a note.
- Files changed in another editor show up when you come back to Kiro, or within 5 seconds. If a note changes outside Kiro while you edit it, Kiro does not overwrite the other version: export your data before reloading the vault.
- Internal links are found by title or file path, ignoring case and accents. If two notes share a title, the first one wins, so prefer distinct titles.

### Safety: history, trash and recovery

- Before each save that changes files, Kiro copies the previous vault into `.history/`. It keeps the 30 most recent saves.
- Changes made by AI assistants keep their own copies, and Kiro saves any human-written text before an AI changes it.
- **Move to trash** sends a note to `.trash/`, and **Trash → Restore** brings it back with the same ID. The trash is never emptied automatically.
- Every file is written atomically. If a save is interrupted, Kiro will not open the vault with half-written data. With Kiro closed, keep a copy of the folder and restore the snapshot named in `.transaction.json` into an empty folder. If `.kiro.lock` is left behind, delete it only after checking nothing else is using the vault.
- Attachments in `Anexos/` are not copied to the history or the trash: deleting a file from that folder cannot be undone.
- None of this replaces a copy on another disk. The exported JSON backup has your active notes and data, but not the history and trash, so copy the whole folder to keep everything.

## Fonts

Kiro bundles its own fonts, so it looks the same on every computer, online or not: **IBM Plex Sans** for the interface, **Literata** for reading notes and **IBM Plex Mono** for code. All three are under the SIL Open Font License, in `fonts/`.

## For developers

```bash
npm ci              # install
npm run desktop     # desktop app
npm start           # browser version at http://localhost:4173
npm test            # tests
npm run test:vivo   # Flow tests in the real app (opens a window)
npm run build:win   # Windows installer
npm run build:linux # .AppImage and .deb (run inside Linux or WSL)
```

### Working in the browser

The browser and the desktop app run the same `index.html`, `app.js` and `styles.css`, so you can work on the interface in the browser and build only when it is ready.

1. Run `npm run dev` and open http://localhost:4180.
2. Edit. `styles.css` updates without reloading; `app.js`, `index.html` and `domain.js` reload the page (saving the open note first); changes to `server.mjs`, `vault.cjs` or `agent/` restart the server.
3. Run `npm test`, then `npm run desktop:dev` to check in the Electron window with the same sample vault.

Development mode uses `dev-vault/`, a sample vault that never touches your personal one. `npm run dev:reset` recreates it. To use another folder, set `KIRO_VAULT`. The local server only accepts connections from your own computer.

```powershell
$env:KIRO_VAULT = 'C:\MyVault'
npm start
```

In the browser version, install a plug-in by copying its folder into `<vault>/.kiro/plugins/`, restarting Kiro and enabling it in Settings. On Linux, each start is logged in `~/.config/kiro/kiro.log`.

### Themes, skins and plug-ins

Colours and shapes always come from CSS variables, never fixed values, so new screens and plug-ins work in every theme. Before creating a theme or skin, read [docs/temas.md](docs/temas.md) and check with `node --test tests/temas.test.cjs`. For plug-ins, read [docs/plugins.md](docs/plugins.md), start from `examples/plugins/` and check with `node --test tests/plugins.test.cjs`.

### Code map

- `vault.cjs`: reading Markdown, saving, snapshots, trash and attachments.
- `domain.js`: shared validation, local dates, tags and links.
- `server.mjs`: local API for the browser version.
- `electron/`: desktop window, IPC bridge and vault choice.
- `app.js`: navigation, editing and the interface.
- `fluxo.js` and `fluxo-tela.js`: the Flow canvas (model and screen).
- `agent/`: Kiro Agent API, validation, permissions, audit and events.
- `mcp/`: MCP server, a thin layer over the Agent API.
- `tests/`: tests in temporary folders; `tests/vivo/`: tests in the real app.

## Privacy

Kiro keeps everything on your own computer, in your vault: a normal folder of Markdown files. There is no account, no tracking and no telemetry. Kiro never sends your notes to us.

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

Kiro only goes online when you ask it to:

- **Google Drive backup:** only if you connect your Google account in Settings. Your backup goes to your own Drive, under Google's privacy policy.
- **Link previews and YouTube videos in Flow:** off by default. If you turn it on (Settings → System → Internet in Flow), Kiro fetches the title and image of a link you paste, and YouTube is contacted when you play a video.
- **Plug-ins that use the network:** each plug-in can only reach the addresses you allow when you turn it on.

## Code signing policy

Windows releases are signed so that Windows can confirm they really come from this project and were not changed.

- Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). *(Application submitted; releases are unsigned until it is approved.)*
- Every signed file is built automatically from this repository by [GitHub Actions](.github/workflows/build.yml), and each release is approved by hand before it is signed.
- Team roles:
  - Committers and reviewers: [GabriellHammes16](https://github.com/GabriellHammes16)
  - Approvers: [GabriellHammes16](https://github.com/GabriellHammes16)
- Privacy: see [Privacy](#privacy) above.

## License

Kiro is free and open source software under the [GNU General Public License v3.0 or later](LICENSE). Third-party parts in `vendor/` and `fonts/` keep their own licenses, which are included next to them.
