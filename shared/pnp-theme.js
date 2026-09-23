// Applies the saved PnPTools colour theme before the page paints (loaded in
// <head>), so light-theme users don't see a dark flash. "auto" follows the OS.
// Canonical copy lives in the hub's shared/ folder (see scripts/sync-shared.sh).
(function () {
    var theme = 'auto';
    try {
        theme = JSON.parse(localStorage.getItem('pnp:theme')) || 'auto';
    } catch (e) { /* storage unavailable: follow the OS */ }
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
})();
