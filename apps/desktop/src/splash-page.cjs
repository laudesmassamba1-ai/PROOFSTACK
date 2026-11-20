/**
 * The launch screen.
 *
 * The account check and the sidecar can take a couple of seconds on a cold machine. Without
 * a window during that time, the app looks like it did nothing; then a login or workspace
 * appears abruptly. This page is local, needs no network, and is replaced the instant the
 * real window is ready.
 */
function splashPageHtml() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PROOFCORE</title>
<style>
:root{--bg:#0b0d10;--fg:#f2f6fa;--dim:#7d8896;--mint:#78e3cb;--green:#73d68b}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:grid;place-items:center;overflow:hidden;background:radial-gradient(90% 80% at 78% -10%,#17252c,#0b0d10 66%);color:var(--fg);font:13px/1.5 ui-sans-serif,system-ui,sans-serif}
.card{display:flex;width:100%;height:100%;flex-direction:column;justify-content:space-between;padding:28px 30px 22px}
.brand{display:flex;align-items:center;gap:12px}
.mark{width:42px;height:42px}
.wordmark{font-size:11px;font-weight:500;letter-spacing:.27em}
.sub{margin-top:4px;color:var(--dim);font-family:ui-monospace,monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase}
.body h1{margin:0;font-size:22px;line-height:1.1;letter-spacing:-.03em;font-weight:560}
.body p{margin:8px 0 0;color:var(--dim);font-size:12px}
.foot{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid rgba(255,255,255,.08);padding-top:12px;font-family:ui-monospace,monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.pulse{display:inline-flex;align-items:center;gap:8px}
.dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 14px 3px rgba(115,214,139,.45);animation:pulse 1.2s ease-in-out infinite}
.bar{width:100%;height:2px;margin-top:20px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.07)}
.bar i{display:block;width:38%;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--mint),var(--green));animation:slide 1.5s ease-in-out infinite}
@keyframes pulse{50%{opacity:.32;transform:scale(.8)}}
@keyframes slide{0%{transform:translateX(-105%)}100%{transform:translateX(285%)}}
@media (prefers-reduced-motion:reduce){.dot,.bar i{animation:none}.bar i{width:65%}}
</style></head><body>
<main class="card">
  <header class="brand">
    <svg class="mark" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <path d="M18 84V12H50C73 12 86 25 86 44C86 61 74 72 52 72H32V84ZM32 26V58H50C61 58 68 51 68 44C68 33 61 26 50 26Z" fill="#70C9DB" fill-rule="evenodd" opacity=".58" stroke="#0b0d10" stroke-width="2.4" transform="translate(9 9)"/>
      <path d="M18 84V12H50C73 12 86 25 86 44C86 61 74 72 52 72H32V84ZM32 26V58H50C61 58 68 51 68 44C68 33 61 26 50 26Z" fill="#78E3CB" fill-rule="evenodd" opacity=".86" stroke="#0b0d10" stroke-width="2.4" transform="translate(4.5 4.5)"/>
      <path d="M18 84V12H50C73 12 86 25 86 44C86 61 74 72 52 72H32V84ZM32 26V58H50C61 58 68 51 68 44C68 33 61 26 50 26Z" fill="#73D68B" fill-rule="evenodd" stroke="#0b0d10" stroke-width="2.4"/>
    </svg>
    <div><div class="wordmark">PROOFCORE</div><div class="sub">moteur local</div></div>
  </header>
  <section class="body">
    <h1>Ouverture de PROOFCORE</h1>
    <p>Vérification du compte et démarrage du moteur local.</p>
    <div class="bar" aria-hidden="true"><i></i></div>
  </section>
  <footer class="foot">
    <span class="pulse"><span class="dot"></span>En cours</span>
    <span>Sur cette machine</span>
  </footer>
</main>
</body></html>`;
}

module.exports = { splashPageHtml };
