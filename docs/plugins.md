# Writing a Kiro plugin

A plugin adds commands and panels to Kiro. It is plain JavaScript — no build
step, no dependencies, no install flow: you copy a folder into a vault and the
owner of that vault turns it on.

Your code runs inside a Web Worker with no DOM, no disk and no network. Every
time it wants something from the vault it asks Kiro, and Kiro checks the
permissions the user granted before answering. That is the whole security model:
you declare what you need, the user agrees to it, and nothing else is reachable.

This document describes **stage 1**, which is what ships today. Features marked
*not available yet* are designed but not implemented; writing code against them
now will simply fail.

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

`kiro.command`, `kiro.panel`, `kiro.notify` and `kiro.storage` need no
permission: they only touch your own plugin.

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

`deactivate()` is part of the design but is *not called yet* in stage 1. Turning
a plugin off terminates its worker outright, so do not rely on a cleanup hook:
anything you need to survive must already be in `kiro.storage`.

### kiro.command(id, label, handler)

Adds an entry to Kiro's command menu. `id` is a non-empty string unique within
your plugin, `label` is what the user reads, `handler` is a function that may be
async. The return value is ignored; use `kiro.notify` to say something.

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

Shows a short status message. Pass `{ error: true }` for the error styling.

### kiro.storage.get(key) / kiro.storage.set(key, value)

Your own JSON storage, kept in `.kiro/plugins/<id>/data.json`, capped at 1 MB.
It is the only place outside notes where a plugin writes. Both are async.

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

## Limits

| Limit | Value | What happens |
|---|---|---|
| Activation | 3 s | The plugin is disabled for the session |
| Any single call | 5 s | The call fails |
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
- Kiro's screen. No DOM, no window, no other plugin's data. Panels are the only
  way to draw, and they are drawn by Kiro from the data you return.
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

Designed, specified, and coming in later stages. Do not write code against them.

**Stage 2 — reacting and rendering**

```js
kiro.onSave(handler)     // after a note is saved
kiro.onCreate(handler)   // after a note is created
kiro.onDay(handler)      // once a day
kiro.block(handler)      // renders ```kiro:<your-id> fenced blocks
```

`kiro.block` will receive the text inside the fenced block and return `{ html }`
or a panel shape; the HTML will pass through an allow-list sanitizer before it
is shown.

**Stage 3 — network**

```js
kiro.fetch(url, { method, headers, body })   // permission: network
```

Kiro, not the worker, will make the request: `https` only, the host must exactly
match one you declared and the user granted, redirects off the list are not
followed, and the response is capped at 5 MB and 10 s.
