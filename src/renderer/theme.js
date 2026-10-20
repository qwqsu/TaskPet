/* 每个窗口只订阅主题变更，不轮询。先用本地缓存绘制，再读取 Main 的权威设置。 */
(() => {
  const themes = new Set(["classic-warm", "midnight-blue", "cream", "forest", "sakura"]);
  const apply = value => {
    const theme = themes.has(value) ? value : "classic-warm";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("taskpet.ui-theme", theme); } catch { /* 只读环境仍可切换当前主题。 */ }
  };
  try { apply(localStorage.getItem("taskpet.ui-theme")); } catch { apply("classic-warm"); }
  const bridge = window.taskPetTheme;
  if (!bridge) return;
  const unsubscribe = bridge.onChanged(apply);
  bridge.get().then(apply).catch(() => {});
  window.addEventListener("beforeunload", unsubscribe, { once: true });
})();
