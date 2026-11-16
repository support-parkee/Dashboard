(() => {
  try {
    const saved = localStorage.getItem('parkee_theme') || 'system';
    const pref = (saved === 'light' || saved === 'dark') ? saved : 'system';
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', pref === 'system' ? 'light dark' : pref);
    const resolved = pref === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : pref;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.dataset.themePref = pref;
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
