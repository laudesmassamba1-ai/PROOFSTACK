/**
 * The page the desktop window loads — written once, in the site's design language.
 *
 * The tokens come from `apps/web/src/styles/global.css` (the [data-theme="dark"] block):
 * paper #0a0a0b, surface #141412, accent #63d6a2, and the same three font families. The
 * motion follows the same rules as the site: durations vary with distance, entrance uses
 * `rise`, and the reduced-motion reset is the canonical one — every animation dies the
 * moment the OS asks, which is a setting people actually use, not an edge case.
 *
 * What makes it feel alive rather than decorated: the status dot breathes while a turn is
 * running and stops when idle, tool calls arrive as rows sliding in, and the assistant's
 * answer rises in as it streams — the same event the loop already produces, so no protocol
 * change was needed for any of this.
 */

/** The CSS shared by the conversation page and the login screen. */
export const pageCss = `
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
textarea{font:inherit;color:var(--ink);background:var(--paper-raised);border:1px solid var(--rule);border-radius:var(--r-lg);padding:12px 14px;resize:none;
  transition:border-color var(--m-base) var(--m-ease),box-shadow var(--m-base) var(--m-ease)}
textarea:focus{outline:none;border-color:rgba(99,214,162,.55);box-shadow:0 0 0 3px rgba(99,214,162,.14)}
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

/** The conversation page: header, transcript, composer, all in the site's language. */
export function conversationShell(options: { model?: string; cwd?: string }): string {
  const model = escapeHtml(options.model ?? "aucun modèle configuré");
  const cwd = escapeHtml(options.cwd ?? "");
  return `
<style>${pageCss}</style>
<style>
body{display:flex;flex-direction:column}
/* ---- header ---- */
.hub-head{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--rule);flex:none}
.brand{display:flex;align-items:center;gap:10px}
.brand-mark{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#73d68b,#0fd9d0);display:grid;place-items:center;color:#06210f;font:800 15px/1 var(--font-display)}
.brand b{letter-spacing:.18em;font-size:11.5px;font-weight:600}
.chip{font:11.5px/1 var(--font-mono);color:var(--ink-soft);background:var(--paper-raised);border:1px solid var(--rule);border-radius:999px;padding:6px 11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34ch}
.hub-status{margin-left:auto;display:flex;align-items:center;gap:8px;font:11.5px/1 var(--font-mono);color:var(--ink-soft)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}
.dot.idle{background:var(--ink-soft);animation:none}
.dot.live{animation:breathe 1.6s var(--m-ease) infinite}
/* ---- transcript ---- */
.transcript{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:20px 20px 8px;max-width:880px;width:100%;margin:0 auto;scroll-behavior:smooth}
.entry{animation:rise var(--m-slow) var(--m-rise) backwards;animation-delay:var(--d,0ms)}
.entry.you{align-self:flex-end;max-width:80%;background:rgba(99,214,162,.09);border:1px solid rgba(99,214,162,.28);border-radius:var(--r-lg) var(--r-lg) var(--r-sm) var(--r-lg);padding:10px 14px;white-space:pre-wrap}
.entry.assistant{align-self:stretch;background:var(--paper-raised);border:1px solid var(--rule);border-radius:var(--r-lg);padding:12px 16px;white-space:pre-wrap}
.entry.tool{align-self:stretch;font:11.5px/1.6 var(--font-mono);color:var(--ink-soft);border-left:2px solid var(--rule);padding:2px 0 2px 12px;white-space:pre-wrap}
.entry.tool.ok{border-left-color:rgba(99,214,162,.6)}
.entry.tool.err{border-left-color:rgba(240,120,132,.7);color:var(--danger)}
.entry .rows{margin:8px 0 0;font:11.5px/1.5 var(--font-mono);max-height:230px;overflow:auto;background:var(--paper);border:1px solid var(--rule);border-radius:var(--r);padding:8px 10px;white-space:pre-wrap}
.entry.approval{align-self:stretch;background:rgba(233,180,90,.07);border:1px solid rgba(233,180,90,.4);border-radius:var(--r-lg);padding:12px 16px;animation:pop var(--m-slow) var(--m-rise) backwards}
.entry.approval .title{font-weight:600;color:var(--warning);margin-bottom:4px}
.entry.approval .actions{display:flex;gap:8px;margin-top:10px}
.entry.approval .verdict{font:11.5px/1.6 var(--font-mono);color:var(--ink-soft);border-left:2px solid var(--rule);padding-left:10px}
/* the thinking shimmer: the turn is running, and you can see it */
.thinking{align-self:flex-start;font:12px/1.6 var(--font-mono);color:transparent;border-radius:999px;padding:4px 0;
  background:linear-gradient(90deg,var(--ink-soft) 25%,var(--ink) 50%,var(--ink-soft) 75%);background-size:200% 100%;
  -webkit-background-clip:text;background-clip:text;animation:shimmer 1.4s linear infinite}
.empty{margin:auto;text-align:center;color:var(--ink-soft);max-width:44ch;animation:rise var(--m-slow) var(--m-rise) backwards}
.empty .brand-mark{margin:0 auto 14px;width:44px;height:44px;border-radius:12px;font-size:22px}
.empty h2{font:600 19px/1.3 var(--font-display);color:var(--ink);margin:0 0 8px}
.empty p{margin:0;font-size:13px}
.empty kbd{font:11px/1 var(--font-mono);background:var(--paper-raised);border:1px solid var(--rule);border-bottom-width:2px;border-radius:5px;padding:2px 6px}
/* ---- composer ---- */
.composer{flex:none;padding:12px 20px 18px}
.composer-inner{display:flex;gap:10px;align-items:flex-end;max-width:880px;margin:0 auto}
.composer textarea{flex:1;min-height:52px;max-height:180px;font-size:14px}
.hint{display:flex;gap:14px;justify-content:center;margin-top:8px;font:10.5px/1 var(--font-mono);color:var(--ink-soft);opacity:.75}
${cwd ? `.path{position:fixed;bottom:4px;right:10px;font:10px/1 var(--font-mono);color:var(--ink-soft);opacity:.5;overflow:hidden;text-overflow:ellipsis;max-width:40ch;white-space:nowrap}` : ""}
</style></head>
<body>
<header class="hub-head">
  <div class="brand"><span class="brand-mark">P</span><b>PROOFCORE</b></div>
  <span class="chip" title="Modèle utilisé par l'agent">${model}</span>
  <div class="hub-status"><span class="dot idle" id="pulse"></span><span id="meta">prêt</span></div>
</header>
<div class="transcript" id="log">
  <div class="empty" style="--d:60ms">
    <span class="brand-mark">P</span>
    <h2>Votre dépôt, votre machine.</h2>
    <p>L'agent lit, modifie et exécute ici — avec votre accord, pièce par pièce. Compte, projets et rapports sont vérifiés en ligne ; tout le reste tourne en local, même sans internet.</p>
  </div>
</div>
<div class="composer">
  <form class="composer-inner" id="f"><textarea id="q" rows="2" placeholder="Demande quelque chose sur ce dépôt…"></textarea><button class="primary" type="submit">Envoyer</button></form>
  <div class="hint"><span><kbd>Ctrl</kbd>+<kbd>Entrée</kbd> ligne</span><span>l'écriture demande votre accord</span></div>
</div>
${cwd ? `<div class="path" title="dossier ouvert par l'agent">${cwd}</div>` : ""}
<script>
const log=document.getElementById('log'), form=document.getElementById('f'), q=document.getElementById('q');
const pulse=document.getElementById('pulse'), meta=document.getElementById('meta');
const empty=log.querySelector('.empty');
const busy=(on,label)=>{pulse.className='dot'+(on?' live':' idle');meta.textContent=label??(on?'en cours…':'prêt')};
const add=(cls,text,delay)=>{if(empty)empty.remove();const d=document.createElement('div');d.className='entry '+cls;if(delay!==undefined)d.style.setProperty('--d',delay+'ms');if(text!==null&&text!==undefined)d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d};
const pre=(parent,text)=>{const p=document.createElement('div');p.className='rows';p.textContent=text;parent.appendChild(p);return p};
const state=async()=>{try{const r=await fetch('/api/state');const s=await r.json();
  const parts=[];parts.push(s.sync?(s.account?'sync '+s.account.email:'sync non connecté'):'sync off');parts.push(s.allowWrite?'écriture auto':'accord requis');
  if(s.model&&s.model!=='non configuré')parts.length||0; meta.textContent=parts.join(' · ')}catch(e){meta.textContent='moteur local'}};
state().then(()=>busy(false));
form.addEventListener('submit',async(e)=>{
  e.preventDefault();const message=q.value.trim();if(!message)return;q.value='';
  add('you',message);
  const thinking=add('thinking',null);thinking.textContent='réfléchit';
  busy(true);
  const statusRow=()=>thinking;
  let toolRow=null;
  const res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message})});
  if(!res.ok){thinking.remove();busy(false);add('tool err','erreur HTTP '+res.status);return}
  const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
  while(true){
    const {value,done}=await reader.read();if(done)break;
    buf+=dec.decode(value,{stream:true});
    let idx;
    while((idx=buf.indexOf('\\n\\n'))>=0){
      const frame=buf.slice(0,idx);buf=buf.slice(idx+2);
      const evt=/^event: (.+)$/m.exec(frame)?.[1];const data=/^data: (.+)$/m.exec(frame)?.[1];
      if(!evt||!data)continue;const payload=JSON.parse(data);
      if(evt==='assistant_text'){add('assistant',payload.text)}
      if(evt==='tool_call'){if(toolRow)toolRow.classList.add('ok');toolRow=add('tool','→ '+payload.name+' '+JSON.stringify(payload.args).slice(0,120));busy(true,payload.name)}
      if(evt==='approval'){
        const box=add('approval',null);box.style.setProperty('--d','0ms');
        const t=document.createElement('div');t.className='title';t.textContent='Approuver '+payload.tool+' ?';box.appendChild(t);
        if(payload.preview)pre(box,payload.preview);
        const actions=document.createElement('div');actions.className='actions';
        const yes=document.createElement('button');yes.className='primary';yes.textContent='Appliquer';
        const no=document.createElement('button');no.className='danger';no.textContent='Refuser';
        const decide=(allow)=>{fetch('/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:payload.id,allow})});
          const verdict=document.createElement('div');verdict.className='verdict';verdict.textContent=(allow?'approuvé':'refusé')+' · '+payload.tool;
          box.replaceChildren(verdict)};
        yes.onclick=()=>decide(true);no.onclick=()=>decide(false);
        actions.append(yes,no);box.appendChild(actions);log.scrollTop=log.scrollHeight;
      }
      if(evt==='result'){if(toolRow)toolRow.classList.add('ok');thinking.remove();busy(false);if(payload.syncError)add('tool err','sync non effectuée: '+payload.syncError)}
      if(evt==='done'){thinking.remove();busy(false);toolRow=null}
    }
  }
  state();
});
q.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
// The composer grows with the text, within the max the CSS allows.
q.addEventListener('input',()=>{q.style.height='auto';q.style.height=Math.min(q.scrollHeight,180)+'px'});
</script></body></html>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
