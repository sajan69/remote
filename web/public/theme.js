try {
  var theme = localStorage.getItem('remote-theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
  var color = document.querySelector('meta[name="theme-color"]')
  if (color) color.setAttribute('content', theme === 'light' ? '#f3eee6' : '#12100e')
} catch (error) {
  /* Storage can be unavailable in private modes. The default theme still applies. */
}
