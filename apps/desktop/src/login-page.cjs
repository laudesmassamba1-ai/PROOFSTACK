/**
 * The screen someone sees when they cannot use the app yet.
 *
 * It is a local page, not a redirect to the site: the app has to be able to explain itself
 * with no network, and a login screen that depends on the network is a login screen that
 * cannot say "no network".
 *
 * Written in the site's design language (`pageCss` — same palette, same motion tokens) with
 * one entrance animation, a breathing dot, and the same reduced-motion reset as the site.
 * Direct credentials are the primary path (same route as the web app); the reason line is
 * always the answer to "why am I here", never just a generic prompt.
 */

const { pageCss } = require("./theme.cjs");

/** Kept as a function of the state so the page never shows a stale reason. */
function loginPageHtml(state, options = {}) {
  const site = options.site ?? "https://proofstack-iota.vercel.app";
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );

  const reasons = {
    "no-session": {
      title: "Connectez-vous pour continuer",
      body: "L'application s'ouvre sur votre compte PROOFCORE. La connexion se fait une fois ; ensuite les outils tournent ici, sur cette machine, même sans internet.",
    },
    expired: {
      title: "Session expirée",
      body: "La période de validité hors ligne est terminée. Reconnectez-vous pour reprendre : vos projets, vos rapports et vos réglages n'ont pas bougé.",
    },
    revoked: {
      title: "Compte non autorisé",
      body: "Le site refuse cette session. Vérifiez l'abonnement du compte, ou connectez-vous avec un autre compte.",
    },
  };
  const reason = reasons[state?.reason] ?? reasons["no-session"];

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PROOFCORE · connexion</title>
<style>${pageCss}</style>
<style>
body{display:grid;place-items:center;padding:24px}
.card{width:min(430px,94vw);animation:rise var(--m-slow) var(--m-rise) backwards}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.brand-mark{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#73d68b,#0fd9d0);display:grid;place-items:center;color:#06210f;font:800 17px/1 var(--font-display)}
.brand b{letter-spacing:.18em;font-size:11.5px;font-weight:600}
h1{margin:0 0 10px;font:600 21px/1.3 var(--font-display);letter-spacing:-.01em}
.lead{margin:0 0 18px;color:var(--ink-soft);font-size:13px}
label{display:block;margin:0 0 12px;color:var(--ink-soft);font-size:12px;font-weight:500}
input{display:block;width:100%;margin-top:6px;border:1px solid var(--rule);border-radius:var(--r);background:var(--paper-raised);color:var(--ink);font:14px/1.4 var(--font-sans);padding:10px 12px;
  transition:border-color var(--m-base) var(--m-ease),box-shadow var(--m-base) var(--m-ease)}
input:focus{outline:none;border-color:rgba(99,214,162,.55);box-shadow:0 0 0 3px rgba(99,214,162,.14)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.status{font:11.5px/1.6 var(--font-mono);color:var(--ink-soft);border-top:1px solid var(--rule);padding-top:12px;margin-top:20px;min-height:18px;white-space:pre-wrap}
.status.working{color:var(--accent)}
.status.error{color:var(--danger)}
.status.ok{color:var(--accent)}
.shake{animation:pop var(--m-slow) var(--m-rise)}
footer{margin-top:14px;font-size:11.5px;color:var(--ink-soft);opacity:.8}
footer button{padding:0;border:none;background:none;color:var(--ink);text-decoration:underline;text-underline-offset:3px}
</style></head>
<body>
<main class="card">
  <div class="brand"><span class="brand-mark">P</span><b>PROOFCORE</b></div>
  <h1>${esc(reason.title)}</h1>
  <p class="lead">${esc(reason.body)}</p>
  <form id="login-form" autocomplete="on">
    <label for="email">Email<input id="email" name="email" type="email" autocomplete="username" required></label>
    <label for="password">Mot de passe<input id="password" name="password" type="password" autocomplete="current-password" required></label>
    <div class="row">
      <button class="primary" id="login" type="submit">Se connecter</button>
      <button id="site" type="button">Créer un compte</button>
    </div>
  </form>
  <div class="status" id="status">${esc(state?.detail ?? "")}</div>
  <footer>Les outils tournent sur cette machine. <button id="why" type="button">Pourquoi un compte ?</button></footer>
</main>
<script>
const status = document.getElementById('status');
const login = document.getElementById('login');
const form = document.getElementById('login-form');
const card = document.querySelector('.card');
const say=(text,cls)=>{status.className='status'+(cls?' '+cls:'');status.textContent=text};
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  login.disabled = true;
  say('Connexion au site…', 'working');
  try {
    const result = await window.proofcoreDesktop.login({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value
    });
    if (result?.allowed) {
      say(result.detail ?? 'Connecté. Ouverture de l\\'application…', 'ok');
      document.querySelector('.lead').textContent = 'Les outils se préparent.';
    } else {
      say(result?.detail ?? "Connexion refusée.", "error");
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      document.getElementById('password').focus();
    }
  } catch (error) {
    say('La connexion a échoué : ' + (error?.message ?? error), 'error');
  } finally {
    login.disabled = false;
  }
});
document.getElementById('site').addEventListener('click', () => window.proofcoreDesktop.openExternal(${JSON.stringify(site.concat("/register"))}));
document.getElementById('why').addEventListener('click', () => window.proofcoreDesktop.openExternal(${JSON.stringify(site)}));
</script>
</body></html>`;
}

module.exports = { loginPageHtml };
