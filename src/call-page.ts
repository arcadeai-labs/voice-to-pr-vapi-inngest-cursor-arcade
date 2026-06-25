// A self-contained "click to talk" web page. Loads the Vapi browser SDK from a
// CDN, starts a web call against the assistant using the PUBLIC key (safe to
// expose in client code), and shows a live transcript. Served at GET /call.

export function callPageHtml(publicKey: string, assistantId: string): string {
  const ready = Boolean(publicKey && assistantId);
  const cfg = `window.__VAPI__=${JSON.stringify({ publicKey, assistantId, ready })};`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Call your codebase</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(1200px 800px at 50% -10%, #1f2937, #0b1020 60%); color:#e5e7eb; }
  .card { width: min(560px, 92vw); padding: 40px 28px 22px; text-align:center; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  p.sub { color:#9ca3af; margin: 0 0 30px; }
  .mic { width:132px; height:132px; border-radius:50%; border:none; cursor:pointer; color:#fff;
    font-size:44px; background: linear-gradient(135deg,#7c3aed,#4f46e5);
    box-shadow: 0 12px 40px rgba(79,70,229,.45); transition: transform .12s ease; }
  .mic:hover { transform: translateY(-2px); }
  .mic:disabled { opacity:.5; cursor:not-allowed; }
  .mic.live { background: linear-gradient(135deg,#ef4444,#b91c1c); animation: pulse 1.6s infinite; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)} 70%{box-shadow:0 0 0 22px rgba(239,68,68,0)} 100%{box-shadow:0 0 0 0 rgba(239,68,68,0)} }
  .status { margin-top:18px; min-height:22px; color:#cbd5e1; font-weight:500; }
  .hint { margin-top:12px; color:#64748b; font-size:13px; }
  .log { margin-top:18px; text-align:left; max-height:230px; overflow:auto; display:flex; flex-direction:column; gap:8px; }
  .line { padding:8px 12px; border-radius:12px; font-size:14px; line-height:1.4; max-width:85%; }
  .line.user { background:#1e293b; align-self:flex-end; }
  .line.assistant { background:#312e81; align-self:flex-start; }
  .chips { margin-top:28px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
  .chip { font-size:12px; color:#94a3b8; border:1px solid #334155; border-radius:999px; padding:4px 10px; }
  .notice { background:#7f1d1d; color:#fecaca; padding:12px; border-radius:12px; margin-bottom:18px; }
</style>
</head>
<body>
  <div class="card">
    <h1>📞 Call your codebase</h1>
    <p class="sub">Tap the mic and say what you want changed — a Cursor agent opens the PR.</p>
    ${ready ? "" : '<p class="notice">Not configured: set VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID.</p>'}
    <button id="mic" class="mic" ${ready ? "" : "disabled"}>🎙️</button>
    <div class="status" id="status">${ready ? "Tap to talk" : "Unavailable"}</div>
    <div class="hint">Try: “there’s a typo in the README, fix it.”</div>
    <div class="log" id="log"></div>
    <div class="chips">
      <span class="chip">Vapi</span><span class="chip">Inngest</span><span class="chip">Cursor</span>
      <span class="chip">Arcade</span><span class="chip">Cloudflare Workers</span>
    </div>
  </div>
<script>${cfg}</script>
<script type="module">
  const C = window.__VAPI__;
  const mic = document.getElementById("mic");
  const statusEl = document.getElementById("status");
  const log = document.getElementById("log");
  const setStatus = (t) => { statusEl.textContent = t; };
  const addLine = (role, text) => {
    const d = document.createElement("div");
    d.className = "line " + (role === "user" ? "user" : "assistant");
    d.textContent = (role === "user" ? "🧑 " : "🤖 ") + text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  };
  if (C.ready) {
    try {
      const mod = await import("https://esm.sh/@vapi-ai/web@2.5.2");
      const Vapi = mod.default;
      const vapi = new Vapi(C.publicKey);
      let live = false;
      mic.addEventListener("click", () => { live ? vapi.stop() : vapi.start(C.assistantId); });
      vapi.on("call-start", () => { live = true; mic.classList.add("live"); mic.textContent = "⏹"; setStatus("Connected — start talking"); });
      vapi.on("call-end", () => { live = false; mic.classList.remove("live"); mic.textContent = "🎙️"; setStatus("Call ended — tap to talk again"); });
      vapi.on("speech-start", () => setStatus("🗣️ Assistant speaking…"));
      vapi.on("speech-end", () => setStatus("🎧 Listening…"));
      vapi.on("message", (m) => { if (m && m.type === "transcript" && m.transcriptType === "final") addLine(m.role, m.transcript); });
      vapi.on("error", (e) => setStatus("Error: " + ((e && e.message) || e)));
    } catch (err) {
      setStatus("Failed to load voice SDK: " + (err && err.message ? err.message : err));
    }
  }
</script>
</body>
</html>`;
}
