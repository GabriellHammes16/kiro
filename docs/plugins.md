# Writing a Kiro plugin

A plugin adds commands and panels to Kiro, reacts to notes being saved or
created, and draws its own fenced blocks inside notes. It is plain JavaScript — no build
step, no dependencies, no install flow: you copy a folder into a vault and the
owner of that vault turns it on.

Your code runs inside a Web Worker with no DOM, no disk and no network. Every
time it wants something from the vault, or from a web API, it asks Kiro, and Kiro checks the
permissions the user granted before answering. That is the whole security model:
you declare what you need, the user agrees to it, and nothing else is reachable.

This document describes everything that ships today, stages 1 to 4.

## Folder layout

```
<vault>/.kiro/plugins/word-count/
  manifest.json
  index.js
```

The folder name must equal the `id` in the manifest. Kiro reads `manifest.json`
directly inside that folder, plus `.js`, `.html` and `.css` files it serves to
your worker and your frames — no subfolders, no other file types. An
`<img src="icon.png">` or a local font file will not load: images and fonts
must be `data:` URLs. `data.json` appears there once you use `kiro.storage`.

Three complete working examples live in this repository: `examples/plugins/word-count/`
(commands, panels, blocks), `examples/plugins/wikipedia-summary/` (a block
that calls a web API with `kiro.fetch`), `examples/plugins/habit-heatmap/`
(a frame — see [Frames (custom UI)](#frames-custom-ui) below) and
`examples/plugins/kanban-tasks/` (a Kanban board of your tasks as a frame page, plus a frame panel with a miniature of the pending columns on Today,
with drag & drop between columns) and `examples/plugins/lista-tarefas/` (a to-do list by status — not started, in progress, paused, done — as a page and a Today card, with the status rules in a plain `estados.js` the tests load too). `npm run dev`
copies all of them into the example vault. Copying one of these folders is the
fastest way to start.

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
| `network` | Optional list of exact hosts, e.g. `api.example.com`. No wildcards, no scheme, no path. A non-empty list also requires the `network` permission. |
| `secrets` | Optional list of API keys the user types in. See [Secrets](#secrets). |
| `settings` | Optional list of plugin settings the user changes in Settings → Plug-ins. See [Plugin settings](#plugin-settings). Needs `minKiro` 0.17.7 or newer. |
| `page` | Optional `{ title, file }`. Gives the plugin its own full-page screen, opened from a "Plug-ins" entry in the sidebar. `title` is 1–40 characters; `file` must match `[a-z0-9][a-z0-9._-]{0,60}\.html` — no slash, no subfolder. See [Frames (custom UI)](#frames-custom-ui). |
| `icon` | Optional. Shown in the sidebar entry, the plugin's cards on Today, its row in Settings → Plug-ins and its command buttons. Either the name of a Kiro icon (e.g. `"tarefas"`, `"calendario"`, `"grafico"`, `"notas"`, `"link"`), which follows the icon pack of the user's theme, or your own drawing as the `d` attribute of an SVG path on a 24×24 grid, e.g. `"M4.5 5h4v14h-4zM10 5h4v9h-4z"` — Kiro strokes it like its own icons (1.75 line, no fill, current text color). Only path letters, digits, spaces, `.`, `,`, `-` and `+` are accepted, up to 2000 characters; SVG or HTML markup is refused. An unknown icon name falls back to the default puzzle piece. Needs Kiro 0.20.3 or newer; older versions ignore the field. |

An invalid manifest does not disable one feature — it stops the plugin from
loading at all, and the reason is shown in Settings → Plug-ins.

## Permissions

Ask for the least you can. Every permission is shown to the user in plain
language before they turn the plugin on, together with every host in `network`
and every key in `secrets`. Adding a permission, a host or a secret in an update
switches the plugin off until they agree again. Removing one is silent.

| Permission | What it unlocks |
|---|---|
| `notes:read` | `notes.list`, `notes.get`, `notes.current`, `notes.search` |
| `notes:write` | `notes.create`, `notes.update`, `notes.trash`, `notes.move` |
| `tasks:read` | `tasks.list` |
| `tasks:write` | `tasks.create`, `tasks.update` |
| `habits:read` | `habits.list` |
| `habits:write` | `habits.mark` |
| `folders:write` | `folders.create` |
| `network` | `kiro.fetch`, only to the hosts listed in `network` that the user granted |

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

### kiro.panel(id, label, render, { options, width })

Adds a card to the Today screen. `render` returns a panel description (see
below) — data, never HTML. It runs on load, on refresh, after every action the
user triggers inside the panel, and after the user changes one of the panel's
options, receiving `{ action, values, options }`.

The user decides where the card goes: they can hide it, move it between
columns and make it full width, from Today → Customize or Settings → Today.
`width: 'full'` is only the starting suggestion. See [Panel options](#panel-options).

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
own in that file (the last day `onDay` ran, see below), plus your plugin's
settings (see [Plugin settings](#plugin-settings)): they never show up in `get`,
and `set` refuses them.

### kiro.settings.get(key)

The values the user chose for your [plugin settings](#plugin-settings), always
complete (defaults filled in). `get()` returns the whole object; `get(key)` one
value. Needs no permission. Also available inside frames.

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

A task is `{ id, title, description, due, priority, done, noteId }`: `due` is
`YYYY-MM-DD`, `priority` is `'Baixa'`, `'Média'` or `'Alta'`, `description` is
free text up to 5000 characters (empty string when there is none) and `noteId`
is the associated note or `''`. `create` and `update` accept the same fields;
sending `description: ''` removes it.

A note can cite a task with `[[tarefa:<id>|Title]]`. The id is what counts —
the title after `|` is only the label, so renaming the task does not break the
citation. These citations are not links between notes: `notes.list` bodies keep
the raw text, and Kiro draws them as a checkbox that completes the task.

Writes go through exactly the same path as the user interface, so history,
atomic writes and the trash all keep working.

### kiro.fetch(url, { method, headers, body, secret })

Requires the `network` permission. The worker itself still has no network: the
request goes up to Kiro — the Electron main process in the desktop app, the
local server on the web — which re-reads your manifest and the user's choices
from the vault, validates everything again and makes the call.

```js
const response = await kiro.fetch('https://pt.wikipedia.org/api/rest_v1/page/summary/Brasil', {
  method: 'GET',                         // optional, default GET
  headers: { accept: 'application/json' },
  // body: 'text only',
  // secret: 'apiKey',                   // see Secrets below
});
// → { status: 200, headers: { 'content-type': 'application/json; ...' }, text: '{...}' }
const page = JSON.parse(response.text);
```

**What resolves and what rejects.** Any HTTP answer resolves, including 404 or
500 — check `status` yourself. The promise rejects only when the request is
refused or never gets an answer: invalid URL, host not granted, timeout, a
response that is too large, a failed connection. The rejection is a regular
`Error` with Kiro's message.

**The request.**

- `url` must be `https://host/path`, port 443 only, no user or password in the
  URL, at most 8192 characters, with no spaces, backslashes or control
  characters. The fragment (`#...`) is dropped and never leaves the computer.
- The host must **exactly** equal one of the hosts in your `network` list that
  the user granted. No wildcards, no subdomains; `api.example.com.` (trailing
  dot) is a different host. A host written as an IP address
  (`https://93.184.216.34/`) is refused — use the name.
- `method`: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. Anything else is refused.
- `headers`: a plain object of string values, up to 4096 characters each, no
  line breaks, no duplicates in different letter case. These names are refused:
  `cookie`, `cookie2`, `set-cookie`, `host`, `origin`, `referer`,
  `authorization`, `proxy-authorization`, `connection`, `content-length`,
  `transfer-encoding`, `te`, `trailer`, `upgrade`, `keep-alive`, `expect`, and
  anything starting with `proxy-` or `sec-`. Kiro sets `user-agent: Kiro-Plugins`
  and `content-length` itself. To send an API key, use `secret`, not a header.
- `body`: a string, up to 1 MB. Send JSON with `JSON.stringify` and a
  `content-type` header. Without a body, `content-type` is not sent.
- No cookies: none are sent and none are kept.

**The response.** `{ status, headers, text }`. `text` is the body decoded as
UTF-8, up to 5 MB. Only these response headers come back, when present:
`content-type`, `content-length`, `etag`, `last-modified`, `cache-control`,
`retry-after`.

**Redirects.** `301`, `302`, `303`, `307` and `308` are followed only when the
new location is also a granted host, and every hop is checked again with the
same rules — https, port 443, no IP address, local network protection. At most 3
redirects. A `303`, or a `301`/`302` answering a `POST`, continues as a `GET`
without the body. A `secret` header is only sent to the secret's own host, so it
is dropped on a hop to any other granted host.

**Local network protection.** A granted host name could still point to your
router, `localhost` or a machine on the local network. Kiro checks the address
the name resolves to *while connecting* — inside the connection's own DNS
lookup, so the address checked is the address used — and refuses the request if
any resolved address is loopback, private, link-local, CGNAT (`100.64.0.0/10`),
multicast, reserved, documentation or unspecified, in IPv4 and IPv6, including
IPv4 mapped or embedded in IPv6 (`::ffff:…`, NAT64, 6to4, Teredo).

**Limits.** 10 s for the whole request, redirects included; 1 MB sent; 5 MB
received.

**On the web** the local server only accepts these requests from Kiro's own
page (same origin), so a website open in the browser cannot use Kiro as a
bridge.

**Typical errors.**

| Message | Why |
|---|---|
| `Host não liberado: api.example.com.` | Not in `network`, or the user has not granted it |
| `Só endereços https são permitidos.` | `http://` or another scheme |
| `Use o nome do host, não um endereço IP.` | IP address in the URL |
| `Cabeçalho não permitido: cookie.` | A forbidden header, see the list above |
| `Método não permitido: HEAD.` | Only GET, POST, PUT, PATCH, DELETE |
| `O corpo passa de 1 MB.` | Request body too large |
| `O host aponta para a rede local; conexão recusada.` | The name resolved to a local or reserved address |
| `Redirecionamento recusado: host não liberado: …` | A redirect left your granted hosts |
| `Muitos redirecionamentos (limite de 3).` | More than 3 hops |
| `O pedido passou do limite de tempo (10 s).` | No complete answer in 10 s |
| `A resposta passou do limite de tamanho (5242880 bytes).` | Response larger than 5 MB |
| `Falha na conexão com host: ENOTFOUND.` | DNS or connection failure; only the error code is kept |
| `Segredo (chave) não declarado: apiKey.` | `secret` is not in your manifest |
| `O segredo apiKey só vale para o host api.example.com.` | `secret` used with another host |
| `A chave apiKey não está configurada.` | The user has not typed the key yet |
| `O plug-in não tem a permissão network.` | Permission not granted |

Messages are in Portuguese, like the rest of Kiro's interface. Match on
`status` for HTTP results, and show the rejection message to the user as-is.

**Audit.** Every call, successful or not, adds a line to `.kiro/audit.log` in the
vault with the plugin id, host, method, HTTP status, bytes received, duration and
the error message when it failed — never the URL path, headers, body or secret.
Settings → Plug-ins also shows the last 10 calls of the session under each
active plugin with network access (time, method, host, status, size), refreshed
when the tab opens.

## Secrets

Some APIs need a key. The user types it in; your code never sees it. Declare it
in the manifest:

```json
"permissions": ["network"],
"network": ["api.deepl.com"],
"secrets": [
  { "name": "apiKey", "label": "DeepL API key", "host": "api.deepl.com",
    "header": "Authorization", "format": "DeepL-Auth-Key {value}" }
]
```

| Field | Rules |
|---|---|
| `name` | A letter followed by letters, digits or `_`, up to 40 characters. Unique in the list. It is what you pass as `secret`. |
| `label` | Up to 80 characters. Shown to the user next to the field. |
| `host` | Must be in your `network` list. The key is only ever sent to this host. |
| `header` | The header Kiro fills in. Any header name except the forbidden ones above — `Authorization` is the exception, since it is exactly what a key is for. |
| `format` | Up to 120 characters, no line breaks, with `{value}` exactly once. Kiro replaces it with the key: `Bearer {value}`, `DeepL-Auth-Key {value}`, or just `{value}`. |

Use it by name:

```js
const response = await kiro.fetch('https://api.deepl.com/v2/translate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: ['Olá'], target_lang: 'EN' }),
  secret: 'apiKey',
});
```

Kiro builds the `header: format` line with the stored value, only when the
request host is exactly the secret's `host`; any other host is an error. If the
user has not configured the key yet, the call rejects with
`A chave apiKey não está configurada.` — tell the user to open Settings.

**How the user configures it.** In Settings → Plug-ins, the plugin's row —
whether the plugin is on, off or waiting for permission — lists each declared
secret with its label, "Enviada só para <host>" and its state, *Configurada* or
*Não configurada*. The user pastes the key into a password field and presses
*Salvar*; the field is cleared right away, whether saving worked or not, and
"Chave salva." or the error appears below it. A configured key shows *Remover*,
which removes it immediately, without a confirmation step.
When turning the plugin on, the consent dialog lists each key with its host; a
key added by an update is marked as new and the plugin waits for permission
again. The value is never shown again — not to the page, not to your plugin, not in
logs, the audit log or error messages. The interface only knows whether a key is
configured.

**Where it is stored.** Outside the vault, per computer, indexed by vault,
plugin and name — a synced or shared vault never carries keys, and each computer
asks for them again.

- **Desktop app:** encrypted with the operating system's key store (Electron
  `safeStorage`) in `plugin-secrets.json` in the app's data folder. If the system
  encryption is not available, the key is not saved.
- **Web version:** `plugin-secrets.json` in the user's configuration folder
  (`%APPDATA%\Kiro\` on Windows, `~/.config/Kiro/` elsewhere), readable only by
  the owner, **not encrypted**. This is a known limitation: without adding a
  dependency, Node cannot reach the system's password store. Anyone who can read
  your user files can read these keys.

Turning a plugin off does not erase its keys; the user removes them with
*Remover*.

## Panel options

Declare the settings your panel needs and Kiro draws the form for them — in the
card's options popover on Today and in Settings → Today. You never build a
settings screen. `render` receives the current values in `options`, always
complete (defaults filled in).

```js
kiro.panel('longest', 'Longest notes', async ({ options }) => {
  /* use options.limit, options.folder, … */
}, {
  options: [
    { key: 'limit', type: 'number', label: 'How many', default: 5, min: 1, max: 20 },
    { key: 'folder', type: 'select', label: 'Folder', default: 'all', choices: ['all', 'work'] },
    { key: 'showDates', type: 'boolean', label: 'Show dates', default: true },
    { key: 'heading', type: 'text', label: 'Heading', default: '' },
  ],
  width: 'full',   // optional: 'normal' (default) or 'full'
});
```

| Field | Rule |
|---|---|
| `key` | `a-z` first, then letters and digits, up to 32 characters, unique |
| `type` | `boolean`, `number`, `select` or `text` |
| `label` | 1–40 characters |
| `default` | Required, of the option's type; `number` between `min` and `max` (both optional); `select` one of `choices`; `text` up to 80 characters |
| `choices` | `select` only: 1–20 strings of up to 40 characters |

Up to 12 options per panel. If the declaration is invalid, the card shows the
error instead of your panel and has no options; the rest of the plugin keeps
working. Values are stored in the vault (`.kiro/hoje.json`); a stored value that
no longer fits your declaration (you changed it in a new version) falls back to
the default.

## Plugin settings

Settings that belong to the whole plugin, not to one panel: how many weeks a
heatmap shows, how a board sorts its cards. Declare them in `manifest.json` and
Kiro draws the form under your plugin in Settings → Plug-ins; you never build a
settings screen.

```json
"settings": [
  { "key": "weeks", "type": "number", "label": "Weeks in the map", "default": 26, "min": 4, "max": 52 },
  { "key": "start", "type": "select", "label": "Week starts on", "default": "Sunday", "choices": ["Sunday", "Monday"] }
]
```

```js
const { weeks, start } = await kiro.settings.get();
```

The fields follow the same rules as [panel options](#panel-options) (same four
types, up to 12). An invalid declaration refuses the plugin, like any other
manifest error. Every change is saved at once, in your plugin's `data.json`
under a key only Kiro writes; Today's panels are redrawn, but a frame that is
already open reads the new values the next time it asks. A stored value that no
longer fits your declaration falls back to the default. Both example plugins
`habit-heatmap` and `kanban-tasks` use settings.

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

## Frames (custom UI)

Panels and block HTML cover lists, tables, forms and short text — Kiro draws
them from the data you return. When you need to draw something yourself —
a chart, a grid, anything with its own interaction — return a **frame**
instead: an isolated `<iframe>` running your own `.html`/`.js`/`.css` files
from your plugin folder, sandboxed away from Kiro and from the rest of the
page.

Prefer a panel or block shape whenever one fits: they cost you no HTML, no
CSP, no message-passing, and they inherit the theme automatically. Reach for
a frame only when free-form drawing is the point.

### Returning a frame

Both `kiro.block` and `kiro.panel` can return `{ frame, data, height }`
instead of `{ html }` or a panel shape:

```js
kiro.block(source => ({ frame: 'chart.html', data: { weeks: 12 }, height: 240 }));
```

| Field | Rules |
|---|---|
| `frame` | Required. The name of an `.html` file in your plugin folder — no subfolders, no `..`. |
| `data` | Optional. Anything JSON-serializable; handed to the frame as `kiro.data`. |
| `height` | Optional pixels, 40–2000, default 240. Only the initial height for a block; call `kiro.resize` from inside the frame afterwards. |

### The page

Declare `"page": { "title", "file" }` in the manifest (see the table above) to
give your plugin a full-page screen of its own `.html` file, opened from a
"Plug-ins" group in the sidebar. It is the same kind of frame, but on its own
screen: `kiro.resize` does nothing there (nothing needs to shrink or grow),
and `kiro.data` is `null` (nothing handed it a block's `data`).

### What the frame can do

Your `.html` file is served with its own CSP, isolated from Kiro's page and
from the worker. Kiro injects a small runtime before your own scripts run,
exposing `window.kiro`:

- `kiro.ready` — a promise that resolves with `kiro` once the frame is wired
  up. Do your first draw inside `.then`, not at the top of the script — the
  vault methods below don't exist until then.
- `kiro.data` — the `data` you returned, or `null` on the page.
- `kiro.onData(fn)` — panels only. Called with the new `data` whenever a panel
  redraws with the same frame file and hands you a fresh `data`. A block's
  frame is never reused this way: a block redraw always recreates the
  `<iframe>` from scratch (see [Redrawing](#redrawing)).
- `kiro.resize(px)` — asks Kiro to change the block's height, clamped to
  40–2000. Call it after you know your content's real height. No-op on the
  page.
- `kiro.openLink(url)` — opens an `http:`/`https:` URL outside Kiro (the
  system browser on desktop, a new tab on the web). Any other scheme is
  refused. This is how a frame opens links: normal `<a>` navigation is
  blocked by the sandbox. **Must be called from a user click** (or another
  gesture that counts as one) — Kiro ignores the request otherwise, so a
  frame cannot open a link on load or from a timer.
- The same vault methods as the worker (`kiro.notes`, `kiro.tasks`,
  `kiro.habits`, `kiro.folders`, `kiro.storage`, `kiro.fetch`, `kiro.notify`),
  filtered by the permissions your plugin was granted — exactly the same two
  checks as everywhere else in this document. `kiro.command`, `kiro.panel`,
  `kiro.block` and the event handlers are **not** available inside a frame:
  registration only happens in `activate`, in the worker.

### What the frame cannot do

- No inline `<script>` and no inline event-handler attribute (`onclick=`,
  `onload=`, …) — the CSP's `script-src` names only Kiro's own origin, so only
  `<script src="...">` to a file in your plugin folder runs.
- No network access whatsoever — `fetch`/`XMLHttpRequest`/`WebSocket`/beacons,
  remote images and fonts, and navigation all fail at the browser level
  (`connect-src 'none'`, an explicit-origin `script-src`/`img-src`/`font-src`).
  Use `kiro.fetch` instead.
- No `localStorage`, `sessionStorage`, `IndexedDB` or cookies — the frame's
  origin is opaque, so browser storage is unavailable or wiped on reload
  anyway. Use `kiro.storage`.
- No submitted `<form>`, no pop-up, no top-level navigation — blocked by the
  sandbox attribute. `RTCPeerConnection` and related WebRTC constructors are
  deleted by Kiro's runtime as a best effort, but this is not a hard
  guarantee: browsers have no CSP directive that restricts WebRTC, so it is
  not covered by the sandbox or CSP the way network and navigation are.

### Theme

The frame receives the same CSS custom properties as the rest of Kiro's
interface, kept in sync when the user switches theme, so plain CSS like
`color: var(--acento)` themes correctly with no JavaScript. The full list:
`--bg`, `--panel`, `--panel-raised`, `--sidebar-bg`, `--content-bg`,
`--campo`, `--ink`, `--muted`, `--line`, `--acento`, `--acento-2`,
`--acento-forte`, `--acento-escuro`, `--acento-texto`, `--primario-texto`,
`--fonte-interface`, `--fonte-leitura`, `--fonte-codigo`.

Prefer the derived tokens for states and meaning, so the plugin follows the user's
accent color, skin and light/dark mode without hardcoding anything:
`--surface-hover`, `--surface-active`, `--selected` (backgrounds for hover, pressed
and selected rows), `--accent-soft`, `--accent-text` (accent for text: darker on
light themes so it stays readable), `--focus-ring`, `--border-strong`,
`--text-disabled`, `--placeholder`, `--danger`, `--warning`, `--success`, `--info`,
`--shadow-sm`, `--shadow-md`, `--raio-controle` and `--raio-card` (corner radius of
controls and cards).

### Example

`examples/plugins/habit-heatmap/` draws a heatmap of habit completions with
`kiro.habits.list()`, both inside a ` ```kiro:habit-heatmap ` block and as its
own page — the same `heatmap.html` serves both, reading `kiro.data?.weeks` in
the block and defaulting to 26 weeks on the page.

### Redrawing

Inside a note, redrawing a block recreates its frame from scratch — the
`<iframe>` reloads, just like any other block redraw. A panel is different:
if two renders return the same `frame` file, Kiro reuses the existing
`<iframe>` and delivers the new `data` through `kiro.onData` instead of
reloading it.

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
| `kiro.fetch` time | 10 s, redirects included | The call rejects |
| `kiro.fetch` request body | 1 MB | The call rejects |
| `kiro.fetch` response | 5 MB | The call rejects |
| `kiro.fetch` redirects | 3 | The call rejects |
| Frame height | 40–2000 px | Clamped to the nearest bound |

An unhandled exception, a crash or silence past a timeout shuts down that one
worker. Other plugins and Kiro itself keep running.

## What a plugin can never reach

- The file system. There is no read-file-by-path, no write-file-by-path, and no
  way to run a command. Nothing outside the vault exists for you.
- The network directly. The response that serves your code carries
  `connect-src 'none'`, so `fetch`, `XMLHttpRequest` or `WebSocket` from the
  worker fail at the browser level. The only way out is `kiro.fetch`, to hosts
  the user granted, never to the local network.
- The value of a secret.
- Kiro's screen. No DOM, no window, no other plugin's data. Panels are drawn
  by Kiro from the data you return, block HTML is sanitized before it is
  shown, and a frame draws only inside its own sandboxed `<iframe>` — it never
  reaches the rest of the page.
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
- A frame shares the app's developer console too — its messages show up under
  the frame's own URL (not tagged with your plugin id), so look for the file
  name you passed as `frame`. Open dev tools and check there when a drawing
  doesn't show up. On the web version, a `frame` naming a file that does not
  exist shows the browser's own "refused to connect" page inside the
  `<iframe>`.
