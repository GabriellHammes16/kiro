// Example plugin for Kiro — copy this folder to <vault>/.kiro/plugins/ to start
// your own. See docs/plugins.md for the full API.
//
// It asks for a single permission (notes:read), registers one command and one
// panel, and never touches anything it did not declare.

// Words are runs of non-space characters. Good enough for a word counter, and
// it costs one line instead of a tokenizer.
const words = text => (String(text || '').trim().match(/\S+/g) || []).length;

export default {
  async activate(kiro) {
    // A command shows up in Kiro's command menu. The handler runs in the worker.
    kiro.command('count', 'Count words in the open note', async () => {
      const note = await kiro.notes.current();
      kiro.notify(note ? `${words(note.body)} words in "${note.title}"` : 'Open a note first.');
    });

    // A panel returns data, never HTML: Kiro draws it with the current theme.
    // render() runs again every time the panel is refreshed or an action fires.
    kiro.panel('longest', 'Longest notes', async () => {
      const notes = await kiro.notes.list({ limit: 50 });
      const ranked = notes
        .map(note => ({ note, count: words(note.body) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      return {
        type: 'list',
        items: ranked.map(({ note, count }) => ({
          title: note.title,
          detail: `${count} words`,
          // "open:<noteId>" is reserved by Kiro: it opens that note.
          action: `open:${note.id}`,
        })),
      };
    });

    // A block draws a ```kiro:word-count fenced block inside a note. It gets the
    // block's text and returns { html } (sanitized by Kiro) or panel data.
    kiro.block(async text => ({ html: `<p><strong>${words(text)}</strong> words in this block</p>` }));
  },
};
