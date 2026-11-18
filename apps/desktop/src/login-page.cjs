/**
 * The screen someone sees when they cannot use the app yet.
 *
 * It is a local page, not a redirect to the site: the app has to be able to explain itself
 * with no network, and a login screen that depends on the network is a login screen that
 * cannot say "no network". Two actions only - sign in, or open the site - and the reason is
 * always spelled out, because "Connectez-vous" without saying why is how people conclude an
 * app is broken.
 */

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
<style>
:root{--bg:#0b0d10;--panel:#14181d;--line:#242b33;--fg:#e8ecf1;--dim:#8b97a5;--acc:#4ade80}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#16202a,#0b0d10 60%);color:var(--fg);font:14px/1.6 ui-sans-serif,system-ui,sans-serif}
.card{width:min(520px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px 26px;box-shadow:0 24px 80px rgba(0,0,0,.45)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.brand b{letter-spacing:.18em;font-size:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--acc);box-shadow:0 0 12px var(--acc)}
h1{margin:0 0 10px;font-size:20px;letter-spacing:-.01em}
p{margin:0 0 18px;color:var(--dim)}
.status{font:12px/1.5 ui-monospace,monospace;color:var(--dim);border-top:1px solid var(--line);padding-top:12px;margin-top:20px;white-space:pre-wrap}
button{cursor:pointer;font:inherit;border-radius:10px;padding:10px 16px;border:1px solid var(--line);background:#1a2027;color:var(--fg)}
button.primary{background:var(--acc);border-color:var(--acc);color:#06210f;font-weight:600}
button:disabled{opacity:.55;cursor:progress}
label{display:block;margin:12px 0 0;color:var(--dim);font-size:12px}
input{display:block;width:100%;margin-top:6px;border:1px solid var(--line);border-radius:9px;background:#0f1318;color:var(--fg);font:14px/1.4 ui-sans-serif,system-ui,sans-serif;padding:10px 11px}
input:focus{outline:2px solid #2b4a37;border-color:var(--acc)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
</style></head><body>
<main class="card">
  <div class="brand"><span class="dot"></span><b>PROOFCORE</b></div>
  <h1>${esc(reason.title)}</h1>
  <p>${esc(reason.body)}</p>
  <form id="login-form" autocomplete="on">
    <label for="email">Email<input id="email" name="email" type="email" autocomplete="username" required></label>
    <label for="password">Mot de passe<input id="password" name="password" type="password" autocomplete="current-password" required></label>
    <div class="row">
      <button class="primary" id="login" type="submit">Se connecter</button>
      <button id="site" type="button">Ouvrir le site</button>
    </div>
  </form>
  <div class="status" id="status">${esc(state?.detail ?? "")}</div>
</main>
<script>
const status = document.getElementById('status');
const login = document.getElementById('login');
const form = document.getElementById('login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  login.disabled = true;
  status.textContent = 'Connexion au site…';
  try {
    const result = await window.proofcoreDesktop.login({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value
    });
    status.textContent = result?.detail ?? '';
    if (result?.allowed) {
      status.textContent = 'Connecté. Ouverture de l\\'application…';
    }
  } catch (error) {
    status.textContent = 'La connexion a échoué : ' + (error?.message ?? error);
  } finally {
    login.disabled = false;
  }
});
document.getElementById('site').addEventListener('click', () => window.proofcoreDesktop.openExternal(${JSON.stringify(site)}));
</script>
</body></html>`;
}

module.exports = { loginPageHtml };
