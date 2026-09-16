# Writing a Kiro plugin

A plugin adds commands and panels to Kiro, reacts to notes being saved or
created, and draws its own fenced blocks inside notes. It is plain JavaScript — no build
step, no dependencies, no install flow: you copy a folder into a vault and the
owner of that vault turns it on.

Your code runs inside a Web Worker with no DOM, no disk and no network. Every
time it wants something from the vault it asks Kiro, and Kiro checks the
permissions the user granted before answering. That is the whole security model:
you declare what you need, the user agrees to it, and nothing else is reachable.

This document describes **stages 1 and 2**, which are what ships today. Features
marked *not available yet* are designed but not implemented; writing code
against them now will simply fail.

## Folder layout

```
<vault>/.kiro/plugins/word-count/
  manifest.json
  index.js
```

The folder name must equal the `id` in the manifest. Kiro only reads
`manifest.json` and `.js` files directly inside that folder — no subfolders, no
other file types. `data.json` appears there once you use `kiro.storage`.

A complete working example lives in `examples/plugins/word-count/` in this
repository, and `npm run dev` copies it into the example vault. Copying that
folder is the fastest way to start.

## manifest.json

```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "author": "Kiro",
  "description": "Counts words in the open note and lists the longest ones.",
  "minKiro": "0.14.0",
  "permissions": ["notes:read"],
  "network": []
}
```

| Field | Rules |
|---|---|
| `id` | Required. 2–40 characters, lowercase letters, digits and hyphens. Must match the folder name. |
| `name` | Required. Up to 200 characters. Shown to the user as plain text. |
| `author` | Required. Up to 200 characters. |
| `description` | Optional. Up to 200 characters. |
| `version` | Required. `major.minor.patch`, e.g. `1.0.0`. |
| `minKiro` | Required. Same format. The plugin is refused when it is newer than the running Kiro. |
| `permissions` | Optional list. Only the names in the table below; an unknown name refuses the whole plugin. |
| `network` | Optional list of exact hosts, e.g. `api.example.com`. No wildcards, no scheme, no path. A non-empty list also requires the `network` permission. Network itself is stage 3, so keep this empty for now. |

An invalid manifest does not disable one feature — it stops the plugin from
loading at all, and the reason is shown in Settings → Plug-ins.

## Permissions

Ask for the least you can. Every permission is shown to the user in plain
language before they turn the plugin on, and adding one later switches the
plugin off until they agree again. Removing one is silent.

| Permission | What it unlocks |
|---|---|
| `notes:read` | `notes.list`, `notes.get`, `notes.current`, `notes.search` |
| `notes:write` | `notes.create`, `notes.update`, `notes.trash`, `notes.move` |
| `tasks:read` | `tasks.list` |
| `tasks:write` | `tasks.create`, `tasks.update` |
| `habits:read` | `habits.list` |
| `habits:write` | `habits.mark` |
| `folders:write` | `folders.create` |
| `network` | `kiro.fetch` — *not available yet* (stage 3) |

`kiro.command`, `kiro.panel`, `kiro.notify`, `kiro.storage`, `kiro.onDay` and
`kiro.block` need no permission: they only touch your own plugin.

`kiro.onSave` and `kiro.onCreate` can always be registered, but their events
carry the whole note, so Kiro only delivers them when the user granted
`notes:read`. Without it the handler simply never runs.

Two separate checks enforce this. The `kiro` object handed to your code only
carries the methods your granted permissions allow, and the host checks the
permission again on every single call — because the worker is your territory and
Kiro does not trust what comes out of it.

## index.js

An ES module with a default export that has an `activate(kiro)` method:

```js
export default {
  async activate(kiro) {
    kiro.command('count', 'Count words', async () => {
      const note = await kiro.notes.current();
      kiro.notify(note ? `${note.body.split(/\s+/).length} words` : 'Open a note first.');
    });
  },
};
```

`activate` is called once, when the plugin is turned on or when Kiro starts with
it already enabled. Register everything you offer inside it — registrations made
later are ignored. It must finish within 3 seconds.

Throwing from `activate` disables the plugin for the session and shows the
message in Settings → Plug-ins.

`deactivate()` is part of the design but is *not called yet*. Turning
a plugin off terminates its worker outright, so do not rely on a cleanup hook:
anything you need to survive must already be in `kiro.storage`.

### kiro.command(id, label, handler)

Adds a command the user runs from **Settings → Plug-ins**, where it is listed
under your plugin. That is the only place commands appear: there is no
right-click menu entry and no button on the Today screen. `id` is a non-empty
string unique within your plugin, `label` is what the user reads, `handler` is a
function that may be async. The return value is ignored; use `kiro.notify` to say
something. After the handler finishes, Kiro redraws your panels, since the
command may have changed what they show.

### kiro.panel(id, label, render)

Adds a card to the Today screen. `render` returns a panel description (see
below) — data, never HTML. It runs on load, on refresh, and again after every
action the user triggers inside the panel, receiving `{ action, values }`:

```js
kiro.panel('longest', 'Longest notes', async (event) => {
  if (event && event.action) { /* a click or a form submit */ }
  return { type: 'text', text: 'hello' };
});
```

### kiro.notify(text, { error })

Shows a temporary notice on screen, prefixed with your plugin's name. It goes
away by itself after 5 seconds (8 seconds with `{ error: true }`, which also uses
the error styling). Text is cut at 300 characters, and at most four notices stack
at once — the oldest leaves first.

### kiro.storage.get(key) / kiro.storage.set(key, value)

Your own JSON storage, kept in `.kiro/plugins/<id>/data.json`, capped at 1 MB.
It is the only place outside notes where a plugin writes. Both are async.
`get(key)` returns `null` for a missing key and `get()` with no key returns the
whole object; `set(key, null)` removes the key. Kiro keeps one internal key of its
own in that file (the last day `onDay` ran, see below): it never shows up in
`get`, and `set` refuses it.

### Events: kiro.onSave, kiro.onCreate, kiro.onDay

```js
kiro.onSave(async ({ note }) => { /* a note changed */ });
kiro.onCreate(async ({ note }) => { /* a note appeared */ });
kiro.onDay(async ({ date }) => { /* first time today, date is 'YYYY-MM-DD' */ });
```

One handler per event; registering again replaces the previous one. Like
everything else, register them inside `activate`. The return value is ignored.

**When `onSave` and `onCreate` fire.** Every time Kiro writes the vault — a save
from the interface or a write made by any plugin — and every time Kiro reloads
the vault and finds that something else changed it (another editor, an MCP
agent). Kiro compares the notes before and after by `updatedAt`: a note that did
not exist before is `create`, a note whose `updatedAt` changed is `save`. A
deleted note fires nothing. They **never** fire on the first load when Kiro opens
the vault, otherwise every note would arrive as a creation.

**Payload.** `{ note }`, the same shape `kiro.notes.get` returns:
`{ id, title, body, tags, folder, createdAt, updatedAt }`. Each changed note is a
separate call. Delivery requires `notes:read`.

**At most 20 notes per event.** If a single write creates or changes more than
that, only the first 20 of each kind are delivered; the rest are dropped, not
queued.

**Loops are cut.** If your handler writes notes (with `notes:write`), that write
does not come back to *you* as an event while your handler is running — other
plugins still receive it. Chains between plugins are cut too: the original write
is level 1, a write made inside a handler produces level 2 events, and so on.
Events are delivered at most three levels deep; a write made while handling a
level 3 event fires nothing.

**`onDay`** fires once per local calendar day per vault, with
`{ date: 'YYYY-MM-DD' }`. Kiro checks when your plugin becomes ready (turned on,
or the app starts with it enabled) and every 5 seconds while the window is
visible, so leaving Kiro open across midnight delivers the new day. The last day
delivered is kept in your plugin's `data.json` in the vault, so closing and
reopening the app the same day does not repeat it. The day is marked *before*
your handler runs: if it throws, it does not run again until tomorrow. No
permission is needed.

**Failures.** An event handler has 5 seconds. Throwing, or taking longer, only
refuses that one event: Kiro shows a notice with your plugin's name and the
error, and your plugin stays on.

### kiro.block(handler)

Draws fenced blocks tagged with your plugin id inside notes. See
[Blocks](#blocks) below.

### Vault methods

All async, all subject to the permission table above.

```js
kiro.notes.list({ limit, folder, since })     // → [{ id, title, body, tags, folder }]
kiro.notes.get(id)                            // → note or null
kiro.notes.current()                          // → the open note, or null
kiro.notes.search(query)                      // → matching notes
kiro.notes.create({ title, folder, body, tags })
kiro.notes.update(id, { title, body, tags, folder })
kiro.notes.trash(id)                          // to the trash, never a hard delete
kiro.notes.move(id, folder)
kiro.tasks.list() / kiro.tasks.create(task) / kiro.tasks.update(id, changes)
kiro.habits.list() / kiro.habits.mark(id, date)
kiro.folders.create(path)
```

Writes go through exactly the same path as the user interface, so history,
atomic writes and the trash all keep working.

## Panels

`render()` returns one of these shapes. Kiro draws it with the user's current
theme, and every string is inserted as text — markup you send is escaped, not
rendered.

```js
{ type: 'text',  text: 'one line' }
{ type: 'list',  items: [{ title, detail, action }] }
{ type: 'cards', items: [{ title, body, action }] }
{ type: 'table', columns: ['A', 'B'], rows: [['1', '2']] }
{ type: 'form',  fields: [{ name, label, type: 'text' | 'number' | 'select', options }], submit: 'save' }
{ type: 'stack', children: [ /* any of the above */ ] }
```

`action` is any string you choose. When the user clicks the item, your `render`
runs again with `{ action, values }`, where `values` holds the form fields when
the action came from a form. One action is reserved by Kiro: `open:<noteId>`
opens that note instead of calling you.

Panels live on the Today screen.

## Blocks

A note can contain a fenced block whose language is `kiro:` followed by a plugin
id:

````markdown
```kiro:word-count
Everything in here is handed to the word-count plugin.
```
````

The id after `kiro:` must be your plugin's `id`. Register one handler per plugin
with `kiro.block`. It receives the text between the fences as a **string** and
returns either:

- `{ html }` — an HTML string. Kiro runs it through its allow-list sanitizer
  (below) before it reaches the page, or
- a panel shape (see [Panels](#panels)). It is drawn with the theme, but inside a
  note it is display-only: `action`s are not clickable.

Anything else shows a message saying the plugin returned nothing to draw.

The example plugin does this:

```js
kiro.block(async text => ({ html: `<p><strong>${words(text)}</strong> words in this block</p>` }));
```

**How it is drawn.** Kiro draws the note first and fills your blocks in right
after. The result is cached by plugin and exact block text: redrawing the note
with the same text shows the cached result without calling you again; change the
text and you are called again. Turning the plugin off clears its cache. Errors are
not cached, so the next redraw of the note retries. Clicking the block opens its
Markdown source for editing, like a code block.

**What the reader sees instead of your drawing:**

| Situation | Shown in the block |
|---|---|
| Plugin not installed or not turned on | A notice that the plugin is not active |
| Plugin active but never called `kiro.block` | A notice that the plugin does not draw blocks |
| Waiting for your handler | A loading notice |
| Handler throws or takes more than 5 s | The error message; the plugin stays on |

### HTML sanitizing

The sanitizer works from an allow-list and rebuilds the HTML from scratch: only
allowed tags and attributes are written back, every attribute value is quoted,
and all text is re-escaped. The input is cut at 200 KB before sanitizing.

**Allowed tags:** `p`, `br`, `hr`, `span`, `div`, `strong`, `em`, `b`, `i`, `u`,
`s`, `code`, `pre`, `blockquote`, `ul`, `ol`, `li`, `h1`–`h6`, `table`, `thead`,
`tbody`, `tr`, `th`, `td`, `a`, `img`, and for SVG `svg`, `g`, `path`, `rect`,
`circle`, `line`, `polyline`, `polygon`, `text`.

- Any other tag is removed, but the text inside it stays.
- `script`, `style`, `iframe`, `object`, `embed`, `template`, `noscript`,
  `foreignObject`, `textarea` and `title` are removed **together with everything
  inside them**.
- Comments and `<!DOCTYPE …>` are removed. Unclosed tags are closed; closing tags
  with no matching opening tag are dropped.

**Allowed attributes:** `class`, `title`, `alt`, `colspan`, `rowspan`, `href`,
`src`, `width`, `height`, `viewBox`, `d`, `fill`, `stroke`, `stroke-width`, `x`,
`y`, `x1`, `y1`, `x2`, `y2`, `cx`, `cy`, `r`, `points`, `text-anchor`,
`font-size`, `transform`. Everything else — every `on…` handler, `style`, `id`,
`target` — is removed. Values are checked after decoding entities and removing
spaces and control characters:

- `href` must start with `http:`, `https:` or `#`. Kiro adds
  `rel="noopener noreferrer"` to every link that keeps its `href`.
- `src` must be a `data:image/png`, `data:image/jpeg`, `data:image/gif`,
  `data:image/webp` or `data:image/svg+xml` URL. Remote images are not allowed.
- Any other attribute is dropped if its value contains `javascript:`,
  `vbscript:`, `data:`, `expression(` or `url(`.

**Links never navigate Kiro's window.** Clicking an `http`/`https` link in a
block opens it outside Kiro (the system browser in the desktop app, a new tab on
the web); clicking any other link does nothing.

## Limits

| Limit | Value | What happens |
|---|---|---|
| Activation | 3 s | The plugin is disabled for the session |
| Command or panel render | 5 s | The plugin is disabled for the session |
| Event handler | 5 s | That event is refused with a notice; the plugin stays on |
| Block render | 5 s | The error shows in the block; the plugin stays on |
| Notes per event | 20 | The rest of that write's notes are not delivered |
| Event chain depth | 3 levels | Deeper events are not fired |
| Block HTML | 200 KB | Cut before sanitizing |
| Message size | 2 MB | The message is refused |
| `kiro.storage` | 1 MB | `storage.set` rejects |

An unhandled exception, a crash or silence past a timeout shuts down that one
worker. Other plugins and Kiro itself keep running.

## What a plugin can never reach

- The file system. There is no read-file-by-path, no write-file-by-path, and no
  way to run a command. Nothing outside the vault exists for you.
- The network, unless stage 3 lands and the user grants specific hosts. The
  response that serves your code carries `connect-src 'none'`, so an attempt
  fails at the browser level rather than relying on you behaving.
- Kiro's screen. No DOM, no window, no other plugin's data. Panels and blocks are
  the only ways to draw: panels are drawn by Kiro from the data you return, and
  block HTML is sanitized before it is shown.
- Anything you did not declare. Calling a method your permissions do not cover
  throws, even if you reach it some other way.

## Debugging

- Settings → Plug-ins lists everything found in the folder, the state of each
  one, and the reason for any that failed — a broken manifest, a missing
  `activate`, a timeout.
- Your worker shares the app's developer console. `console.log` from inside a
  plugin shows up there, tagged with the worker.
- A rejected call comes back as a regular rejected promise with Kiro's message,
  so `try`/`catch` around a vault call tells you what was refused.
- Editing the files takes effect on the next load: toggle the plugin off and on
  in Settings.

## Not available yet

Designed, specified, and coming in a later stage. Do not write code against it.

**Stage 3 — network**

```js
kiro.fetch(url, { method, headers, body })   // permission: network
```

Kiro, not the worker, will make the request: `https` only, the host must exactly
match one you declared and the user granted, redirects off the list are not
followed, and the response is capped at 5 MB and 10 s.
