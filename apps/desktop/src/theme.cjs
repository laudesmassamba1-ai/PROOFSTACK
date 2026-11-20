/**
 * The site's design language, for the pages the desktop renders itself.
 *
 * Single source: apps/cli packages these same tokens in app-page.ts. Kept as a tiny CJS
 * module because the desktop's pages are CommonJS; the values are copied verbatim from
 * apps/web/src/styles/global.css ([data-theme="dark"]), so the window and the site agree on
 * what a surface, a line and an accent look like. If one changes, change both — a test
 * asserts the palette markers stay in sync.
 */

const pageCss = `
:root{
  /* The site's dark palette, verbatim. */
  --paper:#0a0a0b;--paper-raised:#141412;--surface-alt:#1d1d1a;--ink:#f3f0e8;--ink-soft:#b8b3a8;
  --rule:rgba(243,240,232,.14);--accent:#63d6a2;--warning:#e9b45a;--danger:#f07884;
  --font-sans:"Geist Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-display:"Bricolage Grotesque Variable","Geist Variable",ui-sans-serif,sans-serif;
  --font-mono:"JetBrains Mono Variable",ui-monospace,"SFMono-Regular",Menlo,monospace;
  /* Motion tokens: quick feedback, measured movement, one entrance curve. */
  --m-fast:120ms;--m-base:220ms;--m-slow:420ms;--m-ease:cubic-bezier(.22,.61,.21,1);--m-rise:cubic-bezier(.16,1,.3,1);
  --r-sm:6px;--r:10px;--r-lg:16px;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.6 var(--font-sans);-webkit-font-smoothing:antialiased}
::selection{background:rgba(99,214,162,.28)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--r-sm)}
button{cursor:pointer;font:inherit;color:var(--ink);background:var(--paper-raised);border:1px solid var(--rule);border-radius:var(--r);padding:8px 14px;
  transition:background var(--m-fast) var(--m-ease),border-color var(--m-fast) var(--m-ease),transform var(--m-fast) var(--m-ease),box-shadow var(--m-base) var(--m-ease)}
button:hover{background:var(--surface-alt);transform:translateY(-1px)}
button:active{transform:translateY(0)}
button.primary{background:var(--accent);border-color:var(--accent);color:#06210f;font-weight:600}
button.primary:hover{box-shadow:0 6px 22px rgba(99,214,162,.25);background:#74e2b0}
button.ghost{background:transparent;border-color:transparent;color:var(--ink-soft)}
button.ghost:hover{color:var(--ink);background:var(--surface-alt)}
button.danger{border-color:rgba(240,120,132,.5);color:var(--danger)}
button.danger:hover{background:rgba(240,120,132,.1)}
textarea,input{font:inherit;color:var(--ink);background:var(--paper-raised);border:1px solid var(--rule);border-radius:var(--r);padding:12px 14px;
  transition:border-color var(--m-base) var(--m-ease),box-shadow var(--m-base) var(--m-ease)}
textarea:focus,input:focus{outline:none;border-color:rgba(99,214,162,.55);box-shadow:0 0 0 3px rgba(99,214,162,.14)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--surface-alt);border-radius:8px;border:2px solid var(--paper)}
::-webkit-scrollbar-thumb:hover{background:rgba(243,240,232,.2)}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes breathe{0%,100%{box-shadow:0 0 0 0 rgba(99,214,162,.5)}50%{box-shadow:0 0 0 5px rgba(99,214,162,0)}}
@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important}
}
`;

module.exports = { pageCss };
