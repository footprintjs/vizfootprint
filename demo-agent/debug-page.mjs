/**
 * The /debug page — an agent DEBUGGER for the vizfootprint analyst, powered by
 * AgentThinkingUI (atui). It replays the analyst's thinking beat-by-beat for the
 * CURRENT turn: whats_here → dispatch a selection → declare an analysis → the
 * grounded reply — the same live session the dashboard drives.
 *
 * ISOLATION MATTERS (ported verbatim from dress-shop/src/web/debug-page.ts): atui
 * scopes its CSS under `.atui` with zero-specificity `:where(...)` selectors so a
 * host can theme it and it never leaks OUT — but that means a host's NAKED GLOBAL
 * classes (the dashboard's own `.card`, `.chart`, …) leak INTO atui and break its
 * layout. So atui must live in its own document. This page IS that document (only
 * atui + minimal chrome, none of the dashboard's classes), and the storefront's
 * in-page debugger embeds THIS page in an iframe (?embed=1) — a clean CSS
 * boundary, the consumer's responsibility. The dashboard mirrors the dress-shop's
 * exact rationale:
 *   "atui scopes its CSS with zero-specificity :where(.atui …) so a host can
 *    theme it; the flip side is the storefront's naked global classes … would
 *    leak IN and break atui's layout. An iframe is a clean document boundary."
 *
 * No bundler: atui ships a UMD build that reads React/ReactDOM from globals, so
 * we load React + ReactDOM + the atui UMD + its stylesheet — ALL from /vendor
 * (LOCAL, never a CDN: hardened + works offline; the dress-shop pulled React off
 * unpkg, we vendor it too so the debugger has zero external requests) — then
 * mount <AgentThinkingUI trace={…}/> via React.createElement (no JSX). The trace
 * is agentfootprint's `agentThinkingTrace()` output (atui's native shape), served
 * from GET /api/trace.
 */
export const DEBUG_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>vizfootprint · Analyst debugger</title>
<link rel="stylesheet" href="/vendor/atui.css" />
<style>
  :root{ --bg:#f7f8fa; --ink:#1a1d24; --muted:#6b7280; --line:#e4e7ec; --card:#ffffff; --accent:#2f6fed; --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif }
  *{box-sizing:border-box}
  [hidden]{display:none !important}
  html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans);display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--card)}
  header .t{font-weight:700}
  header .sub{color:var(--muted);font-size:12.5px}
  header a{margin-left:auto;color:var(--accent);text-decoration:none;font-weight:600;font-size:13px}
  #root{flex:1;min-height:0;overflow:hidden}
  .ph{height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);padding:40px;text-align:center}
  #reply{padding:10px 18px;border-top:1px solid var(--line);background:var(--card);color:var(--ink);font-size:14px}
  .bar{display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--line);background:var(--card)}
  .bar input{flex:1;padding:11px 14px;border:1px solid var(--line);border-radius:12px;font:15px var(--sans);background:var(--bg);color:var(--ink)}
  .bar button{background:var(--accent);color:#fff;border:0;border-radius:12px;padding:11px 20px;font:600 15px var(--sans);cursor:pointer}
  /* embed mode (iframed inside the dashboard modal): just atui, no chat chrome */
  body.embed > header, body.embed > .bar, body.embed > #reply{display:none !important}
  body.embed{background:var(--card)}
</style>
</head>
<body>
<header>
  <span class="t">🐛 Analyst debugger</span>
  <span class="sub">watch the analyst think — same live session as the dashboard</span>
  <a href="/">← back to the dashboard</a>
</header>
<div id="root"></div>
<div id="reply" hidden></div>
<div class="bar">
  <input id="msg" autocomplete="off" placeholder='Try: "Is price correlated with rating? Declare it and read the ledger honestly."' />
  <button id="send">Send</button>
</div>

<script src="/vendor/react.js"></script>
<script src="/vendor/react-dom.js"></script>
<script src="/vendor/atui.umd.js"></script>
<script>
  function $(id){ return document.getElementById(id); }
  async function post(url,body){ var r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
  var EMBED = /[?&]embed/.test(location.search);
  if(EMBED) document.body.classList.add('embed');

  if(!window.AgentThinkingUI){ $('root').innerHTML='<div class="ph">Could not load AgentThinkingUI from /vendor — the debugger assets are missing.</div>'; }
  var root = window.AgentThinkingUI ? ReactDOM.createRoot($('root')) : null;
  var running=false, trace=null;

  function render(){
    if(!root) return;
    if(!trace || !trace.steps || !trace.steps.length){
      root.render(React.createElement('div',{className:'ph'}, running ? 'The analyst is thinking…' : 'Ask the analyst below — the reasoning renders here as it thinks.'));
      return;
    }
    var last=trace.steps[trace.steps.length-1];
    var live = running || (EMBED && last && last.kind!=='answer');
    root.render(React.createElement(window.AgentThinkingUI, {
      trace: trace, live: live, theme:{ mode:'light' }, labels:{ agent:'Viz Analyst' }, toolMenu:'rack',
      onExplain: onExplain
    }));
  }
  // The REAL "why this tool?": hand atui's prepared prompt to Claude (server-side,
  // where the key lives) and return the model's own reasoning.
  async function onExplain(args){
    try{ var r=await post('/api/explain', { prompt: args.prompt, kind: args.kind }); return { reason: r.reason || r.error || '(no explanation)' }; }
    catch(e){ return { reason: '⚠ '+e }; }
  }
  async function pull(){ try{ var t=await (await fetch('/api/trace')).json(); if(t){ trace=t; render(); } }catch(e){} }

  async function runTurn(message){
    running=true; $('reply').hidden=true; render();
    var timer=setInterval(pull,500);
    try{
      var turn=await post('/api/chat',{message:message});
      if(turn && turn.text){ $('reply').textContent='💬 '+turn.text; $('reply').hidden=false; }
      else if(turn && turn.error){ $('reply').textContent='⚠ '+turn.error; $('reply').hidden=false; }
    }catch(e){ $('reply').textContent='⚠ '+e; $('reply').hidden=false; }
    finally{ clearInterval(timer); running=false; await pull(); render(); }
  }

  $('send').onclick=function(){ var m=$('msg').value.trim(); if(!m) return; $('msg').value=''; runTurn(m); };
  $('msg').addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); $('send').click(); } });

  if(EMBED){
    // Embedded in the dashboard modal: no chat here — just mirror the current
    // turn's reasoning, polling so it stays fresh if opened mid-turn.
    pull();
    setInterval(pull, 900);
  } else {
    render();
  }
</script>
</body>
</html>`;
