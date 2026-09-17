// Example network plugin for Kiro. See docs/plugins.md for the full API.
//
// A note containing
//
//   ```kiro:wikipedia-summary
//   Brasil
//   ```
//
// shows the summary of that article from the Portuguese Wikipedia. The plugin
// asks for the network permission and a single host, pt.wikipedia.org. Kiro makes
// the request, not the worker: kiro.fetch refuses any other host.

// Kiro sanitizes block HTML again, but escaping text you put inside HTML is your
// job: a title or summary with "<" must show up as text, not as markup.
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const message = text => ({ html: `<p><em>${escape(text)}</em></p>` });

export default {
  async activate(kiro) {
    kiro.block(async source => {
      const title = source.trim().split('\n')[0].trim();
      if (!title) return message('Write an article title inside the block, e.g. Brasil.');

      // Wikipedia uses underscores for spaces in page URLs.
      const url = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      // Network errors (timeout, refused host, no connection) reject: the block
      // shows the message. Only HTTP answers come back as { status, headers, text }.
      const response = await kiro.fetch(url, { headers: { accept: 'application/json' } });

      if (response.status === 404) return message(`No Wikipedia article called "${title}".`);
      if (response.status !== 200) return message(`Wikipedia answered with status ${response.status}. Try again later.`);

      let page;
      try { page = JSON.parse(response.text); } catch { return message('Wikipedia sent a response that is not valid JSON.'); }
      if (!page || typeof page.extract !== 'string') return message(`No summary available for "${title}".`);

      const link = page.content_urls && page.content_urls.desktop && page.content_urls.desktop.page;
      return {
        html: `<h3>${escape(page.title || title)}</h3>`
          + `<p>${escape(page.extract)}</p>`
          + (typeof link === 'string' && link.startsWith('https://') ? `<p><a href="${escape(link)}">Read on Wikipedia</a></p>` : ''),
      };
    });
  },
};
