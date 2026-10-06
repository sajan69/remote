try {
  var stored = localStorage.getItem('remote-theme');
  var theme = stored === 'light' || stored === 'dark' ? stored : 'system';
  var dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  var color = document.querySelector('meta[name="theme-color"]');
  if (color) color.setAttribute('content', dark ? '#12100e' : '#f7f3ec');
} catch (error) {
  /* Storage can be unavailable in private modes. The default theme still applies. */
}
