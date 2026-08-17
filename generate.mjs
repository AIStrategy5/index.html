// Weekly dashboard generator — runs inside GitHub Actions.
// 1) (optional) refresh data.json via Claude API + web search  2) render dashboard
// 3) encrypt with the team password  4) write index.html   The workflow then commits.
import fs from 'fs';
import crypto from 'crypto';

const PW = process.env.DASHBOARD_PASSWORD;
if (!PW) { console.error('DASHBOARD_PASSWORD secret is not set — aborting.'); process.exit(1); }

const rawIn = fs.readFileSync('data.json', 'utf8');
let data = JSON.parse(rawIn);
const template = fs.readFileSync('template.html', 'utf8');

// ---------- optional AI refresh (best-effort, fail-safe) ----------
async function aiRefresh(data) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.log('No ANTHROPIC_API_KEY set — re-rendering existing verified data (no AI refresh).'); return data; }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const existing = data.DATA.filter(d => !d.decera).map(d => d.title.toLowerCase());
  const prompt = `You are refreshing a competitive-intelligence dataset for Decera Clinical Education (a medical-education/CME company). Using web search, find NEW industry-supported / satellite-symposium CME activities from COMPETITOR medical-education companies (e.g. PeerView, Med Learning Group, ACHL, CME Outfitters, Prova, HMP Education, RMEI, Medtelligence, ReachMD, Academic CME, Postgraduate Healthcare Education, PER, Global Education Group, American Academy of CME, Voxmedia, and others) in NON-ONCOLOGY therapeutic areas (cardiovascular, nephrology, endocrinology, rare disease, ophthalmology, dermatology, rheumatology, gastroenterology, pulmonology, allergy/immunology), dated within the LAST 12 MONTHS.
STRICT: include an activity ONLY if you can open its live source page and quote its learning objectives VERBATIM, and only if it is NOT already in this list of known titles: ${JSON.stringify(existing)}.
Output ONLY a JSON array (no prose, no code fences). Each element: {"comp","ta","sub","title","congress","date","audience","supporter","los":["verbatim objective", ...],"src":"https://source-url","up":false}. If a source does not name a supporter, use "not stated on source". If you find nothing new that meets the bar, output [].`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) { console.log('Anthropic API error', res.status, (await res.text()).slice(0, 300), '— keeping existing data.'); return data; }
    const body = await res.json();
    const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) { console.log('AI returned no JSON array — keeping existing data.'); return data; }
    const add = JSON.parse(m[0]);
    const clean = (Array.isArray(add) ? add : [])
      .filter(x => x && x.title && x.src && /^https?:\/\//.test(x.src) && Array.isArray(x.los) && x.los.length)
      .filter(x => !existing.includes(String(x.title).toLowerCase()))
      .map(x => ({ comp: x.comp || 'Unknown', decera: false, up: !!x.up, ta: x.ta || '', sub: x.sub || '',
        title: x.title, congress: x.congress || '', date: x.date || '', audience: x.audience || '',
        supporter: x.supporter || 'not stated on source', los: x.los.map(String), src: x.src }));
    if (clean.length) { data.DATA = data.DATA.concat(clean); console.log('AI refresh added', clean.length, 'new verified activities.'); }
    else console.log('AI refresh found no new verified activities.');
    return data;
  } catch (e) { console.log('AI refresh failed:', e.message, '— keeping existing data.'); return data; }
}

// ---------- render ----------
function render(data) {
  return template
    .replace('__DATA__', JSON.stringify(data.DATA))
    .replace('__GAPS__', JSON.stringify(data.GAPS))
    .replace('__OVERLAPS__', JSON.stringify(data.OVERLAPS))
    .replace('__SWEPT__', JSON.stringify(data.SWEPT))
    .replace('__SOURCES__', JSON.stringify(data.SOURCES))
    .replace('__SUPPORTERS__', JSON.stringify(data.SUPPORTERS || []));
}

// ---------- encrypt (matches the in-browser Web Crypto gate) ----------
function encrypt(plaintext, pw) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), ITER = 300000;
  const keyb = crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', keyb, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
  const payload = Buffer.concat([ct, c.getAuthTag()]); // ciphertext || 16-byte tag
  return JSON.stringify({ salt: salt.toString('base64'), iv: iv.toString('base64'), ct: payload.toString('base64'), iter: ITER });
}

const GATE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Decera Competitive Intelligence — Protected</title>
<style>
:root{color-scheme:dark light}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1419;color:#e6edf3;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.box{background:#171e27;border:1px solid #2b3644;border-radius:14px;padding:30px 28px;max-width:380px;width:90%;
box-shadow:0 8px 30px rgba(0,0,0,.4);text-align:center}
.eyebrow{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#4a9eff;font-weight:700}
h1{font-size:18px;margin:8px 0 4px}
p{color:#9aa7b4;font-size:13px;margin:0 0 18px}
input{width:100%;box-sizing:border-box;background:#0f1419;border:1px solid #2b3644;color:#e6edf3;
border-radius:9px;padding:11px 12px;font-size:15px;margin-bottom:10px}
button{width:100%;background:#4a9eff;color:#fff;border:0;border-radius:9px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#3b8ae6}
.err{color:#e8663d;font-size:12.5px;height:16px;margin-top:8px}
.foot{color:#6b7889;font-size:11px;margin-top:16px}
</style></head><body>
<div class="box">
<div class="eyebrow">Decera Clinical Education</div>
<h1>Competitive Intelligence Dashboard</h1>
<p>Protected — Decera Multi Team. Enter the team password to view.</p>
<form id="f"><input id="pw" type="password" placeholder="Team password" autofocus autocomplete="current-password">
<button type="submit">Unlock</button></form>
<div class="err" id="e"></div>
<div class="foot">Confidential · Non-oncology satellite symposium tracker</div>
</div>
<script>
const P=__PAYLOAD__;
const d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function unlock(pw){
  const salt=d(P.salt),iv=d(P.iv),ct=d(P.ct);
  const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:P.iter,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["decrypt"]);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ct);
  return new TextDecoder().decode(pt);
}
document.getElementById("f").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=e.target.querySelector("button");btn.textContent="Unlocking…";
  try{const html=await unlock(document.getElementById("pw").value);document.open();document.write(html);document.close();}
  catch(err){document.getElementById("e").textContent="Incorrect password.";btn.textContent="Unlock";}
});
</script></body></html>`;

// ---------- run ----------
data = await aiRefresh(data);
const out = JSON.stringify(data, null, 1);
const changed = out.trim() !== rawIn.trim();
if (changed) fs.writeFileSync('data.json', out);
if (changed || !fs.existsSync('index.html')) {
  const plain = render(data);
  fs.writeFileSync('index.html', GATE.replace('__PAYLOAD__', encrypt(plain, PW)));
  console.log((changed ? 'Data changed' : 'index.html missing') + ' — built index.html:',
    data.DATA.filter(d => !d.decera).length, 'competitor activities,',
    data.DATA.filter(d => d.decera).length, 'Decera activities,', data.GAPS.length, 'gaps.');
} else {
  console.log('No data changes this week — nothing to rebuild.');
}
