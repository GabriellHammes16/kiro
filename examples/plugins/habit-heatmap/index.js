// Example plugin for Kiro — copy this folder to <vault>/.kiro/plugins/ to start
// your own. See docs/plugins.md for the full API, section "Frames (custom UI)".
//
// It draws a free-form heatmap, so it uses a frame instead of a panel shape:
// ```kiro:habit-heatmap
// 12
// ```
// draws the last N weeks in a frame; an empty block uses the "Semanas no mapa"
// setting (Settings → Plug-ins). The same heatmap.html is the plugin's page,
// opened from "Plug-ins" in the sidebar.
export default {
  activate(kiro) {
    kiro.block(async source => {
      const { semanas: padrao } = await kiro.settings.get();
      const semanas = Math.min(52, Math.max(1, parseInt(source, 10) || padrao));
      return { frame: 'heatmap.html', data: { weeks: semanas }, height: 60 + 18 * 7 };
    });
  },
};
