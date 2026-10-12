// Rodeo: the request is the commit.
// Agents race to build the same plain-English request on their own Artifacts forks.
// A judge scores each fork against the owner's checks. The owner says YES on their phone.
// If main moved underneath, Rodeo replays the request on the new code instead of forcing an old patch.
// MIT License. Built by Jacob Malherbe (a "Rancher": a builder who could not code before AI) with Claude.

const REPO = 'barn-coffee';
const RIDERS = [
  { slot: 1, name: 'Llama 3.3 70B', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', max: 4096 },
  { slot: 2, name: 'Qwen 2.5 Coder 32B', model: '@cf/qwen/qwen2.5-coder-32b-instruct', max: 4096 },
  { slot: 3, name: 'Mistral Small 3.1', model: '@cf/mistralai/mistral-small-3.1-24b-instruct', max: 4096 },
];
const JUDGE = { name: 'GPT-OSS 120B', model: '@cf/openai/gpt-oss-120b', max: 6000 };
// The demo site Rodeo creates on first setup (POST /api/setup).
const SEED = {"index.html": "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Barn Coffee</title>\n<style>\n  :root { --bg:#f6f1e9; --ink:#2b2118; --accent:#8a4b2a; --card:#fffaf3; }\n  * { box-sizing:border-box; }\n  body { margin:0; font-family: Georgia, serif; background:var(--bg); color:var(--ink); }\n  header { padding:40px 20px 24px; text-align:center; }\n  h1 { margin:0; font-size:40px; letter-spacing:1px; }\n  .tag { margin:8px 0 0; font-style:italic; color:var(--accent); }\n  main { max-width:560px; margin:0 auto; padding:0 16px 40px; }\n  h2 { font-size:20px; border-bottom:2px solid var(--accent); padding-bottom:6px; }\n  .item { display:flex; justify-content:space-between; background:var(--card); padding:12px 14px; margin:8px 0; border-radius:10px; }\n  .item small { display:block; color:#7a6a5a; font-size:13px; }\n  .hours { background:var(--card); padding:14px; border-radius:10px; line-height:1.6; }\n  footer { text-align:center; font-size:13px; color:#7a6a5a; padding:20px; }\n</style>\n</head>\n<body>\n<header>\n  <h1>Barn Coffee</h1>\n  <p class=\"tag\">Small batch coffee in an old red barn.</p>\n</header>\n<main>\n  <h2>Menu</h2>\n  <div id=\"menu\">Loading menu...</div>\n  <h2>Hours</h2>\n  <div class=\"hours\">Mon to Fri: 7am to 3pm<br>Sat: 8am to 2pm<br>Sun: Closed</div>\n</main>\n<footer>12 Orchard Road</footer>\n<script>\nfetch('menu.json').then(r => r.json()).then(items => {\n  document.getElementById('menu').innerHTML = items.map(i =>\n    '<div class=\"item\"><div>' + i.name + '<small>' + (i.note || '') + '</small></div><div>$' + i.price.toFixed(2) + '</div></div>'\n  ).join('');\n});\n</script>\n</body>\n</html>\n", "menu.json": "[\n  { \"name\": \"Drip Coffee\", \"price\": 3.00, \"note\": \"House roast, bottomless refills\" },\n  { \"name\": \"Latte\", \"price\": 4.75, \"note\": \"Double shot, whole or oat milk\" },\n  { \"name\": \"Cappuccino\", \"price\": 4.50, \"note\": \"\" },\n  { \"name\": \"Cold Brew\", \"price\": 4.25, \"note\": \"Steeped 18 hours\" },\n  { \"name\": \"Cinnamon Roll\", \"price\": 3.95, \"note\": \"Baked every morning\" }\n]\n", "README.md": "# Barn Coffee\n\nDemo site for Rodeo. Every change to this repo starts as a plain English request.\nThe request is saved in .rodeo/intents/ next to the code it produced.\n"};
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- gitlite: the smallest git push that works from a Worker ---------------- */
const enc = new TextEncoder();
const ZERO = '0000000000000000000000000000000000000000';
function concat(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; }
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
async function sha1(b) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', b))); }
async function hashObject(type, body) { return sha1(concat([enc.encode(type + ' ' + body.length + '\0'), body])); }
async function deflate(b) { return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
async function buildTree(files, objects) {
  const groups = new Map();
  for (const [p, v] of Object.entries(files)) {
    const i = p.indexOf('/');
    if (i < 0) groups.set(p, { blob: typeof v === 'string' ? enc.encode(v) : v });
    else { const d = p.slice(0, i); if (!groups.has(d)) groups.set(d, { sub: {} }); groups.get(d).sub[p.slice(i + 1)] = v; }
  }
  const entries = [];
  for (const [name, g] of groups) {
    if (g.blob) { const h = await hashObject('blob', g.blob); objects.push({ type: 3, body: g.blob }); entries.push({ mode: '100644', name, h, key: name }); }
    else entries.push({ mode: '40000', name, h: await buildTree(g.sub, objects), key: name + '/' });
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const body = concat(entries.map((e) => concat([enc.encode(e.mode + ' ' + e.name + '\0'), unhex(e.h)])));
  objects.push({ type: 2, body });
  return hashObject('tree', body);
}
async function pack(objects) {
  const n = objects.length;
  const parts = [enc.encode('PACK'), new Uint8Array([0, 0, 0, 2]), new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])];
  for (const o of objects) {
    let size = o.body.length; const hdr = [(o.type << 4) | (size & 15)]; size >>>= 4;
    while (size > 0) { hdr[hdr.length - 1] |= 0x80; hdr.push(size & 0x7f); size >>>= 7; }
    parts.push(new Uint8Array(hdr), await deflate(o.body));
  }
  const body = concat(parts);
  return concat([body, unhex(await sha1(body))]);
}
const pkt = (s) => { const b = enc.encode(s); return concat([enc.encode((b.length + 4).toString(16).padStart(4, '0')), b]); };
function parsePkts(buf) {
  const out = []; let i = 0; const dec = new TextDecoder();
  while (i + 4 <= buf.length) { const n = parseInt(dec.decode(buf.slice(i, i + 4)), 16); if (!n) { out.push(null); i += 4; continue; } out.push(dec.decode(buf.slice(i + 4, i + n))); i += n; }
  return out;
}
async function remoteRefs(remote, token) {
  const r = await fetch(remote + '/info/refs?service=git-receive-pack', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('info/refs ' + r.status);
  const refs = {};
  for (const l of parsePkts(new Uint8Array(await r.arrayBuffer()))) {
    if (!l || l.startsWith('#')) continue;
    const sp = l.indexOf(' '); const h = l.slice(0, sp); const name = l.slice(sp + 1).split('\0')[0].trim();
    if (h !== ZERO) refs[name] = h;
  }
  return refs;
}
async function pushSnapshot({ remote, token, branch = 'main', files, message, parent, expectOld, author = { name: 'Rodeo', email: 'rodeo@rodeo.local' } }) {
  const refs = await remoteRefs(remote, token);
  const ref = 'refs/heads/' + branch;
  if (expectOld !== undefined && (refs[ref] || ZERO) !== (expectOld || ZERO)) throw new Error('stale ref: ' + ref + ' moved');
  const old = refs[ref] || ZERO;
  const objects = [];
  const tree = await buildTree(files, objects);
  const ts = Math.floor(Date.now() / 1000);
  const who = author.name + ' <' + author.email + '> ' + ts + ' +0000';
  const cbody = enc.encode('tree ' + tree + '\n' + (parent ? 'parent ' + parent + '\n' : '') + 'author ' + who + '\ncommitter ' + who + '\n\n' + message.trim() + '\n');
  const commit = await hashObject('commit', cbody);
  objects.push({ type: 1, body: cbody });
  const body = concat([pkt(old + ' ' + commit + ' ' + ref + '\0report-status agent=rodeo/1\n'), enc.encode('0000'), await pack(objects)]);
  const r = await fetch(remote + '/git-receive-pack', { method: 'POST', body, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-git-receive-pack-request', Accept: 'application/x-git-receive-pack-result' } });
  const lines = parsePkts(new Uint8Array(await r.arrayBuffer())).filter(Boolean);
  if (!(r.ok && lines.some((l) => l.startsWith('unpack ok')) && lines.some((l) => l.startsWith('ok ' + ref)))) throw new Error('push rejected: ' + r.status + ' ' + lines.join(' | ').slice(0, 200));
  return { commit, tree };
}

/* ---------------- Artifacts helpers ---------------- */
async function withRepo(env, name, fn) {
  const r = await env.ARTIFACTS.get(name);
  try { return await fn(r); } finally { try { r[Symbol.dispose] && r[Symbol.dispose](); } catch (e) {} }
}
async function snapshot(env, name, ref) {
  return withRepo(env, name, async (r) => {
    const l = await r.log({ ref, limit: 1 }); const c = l[0];
    if (!c) return { commit: null, files: {} };
    const files = {};
    const walk = async (th, pre) => {
      for (const e of (await r.readTree(th)) || []) {
        if (e.type === 'tree') await walk(e.hash, pre + e.name + '/');
        else if (e.type === 'blob') { const b = await r.readBlob(e.hash); files[pre + e.name] = b ? await b.text() : ''; }
      }
    };
    await walk(c.treeHash, '');
    return { commit: c.hash, message: c.message, files };
  });
}
async function writeAccess(env, name) {
  return withRepo(env, name, async (r) => { const info = await r.info(); const t = await r.createToken('write', 1800); return { remote: info.remote, token: t.plaintext }; });
}
async function forkFor(env, name) {
  try { await withRepo(env, REPO, (r) => r.fork(name, { defaultBranchOnly: true, description: 'Rodeo lane' })); } catch (e) { if (!/exist/i.test(String(e))) throw e; }
  let last;
  for (let i = 0; i < 40; i++) { try { return await writeAccess(env, name); } catch (e) { last = e; await sleep(750); } }
  throw new Error('fork not ready: ' + (last && last.message));
}
async function pushRetry(opts) {
  let last;
  for (let i = 0; i < 4; i++) { try { return await pushSnapshot(opts); } catch (e) { last = e; await sleep(1500); } }
  throw last;
}
async function dropRepo(env, name) { if (!name || name === REPO) return; try { await env.ARTIFACTS.delete(name); } catch (e) {} }

/* ---------------- D1 helpers ---------------- */
const all = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results || [];
const one = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).first();
const run = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).run();
const evt = (env, id, text) => run(env, 'INSERT INTO events(intent_id,at,text) VALUES(?,?,?)', id, now(), text);
async function setIntent(env, id, f) { const k = Object.keys(f); await run(env, 'UPDATE intents SET ' + k.map((x) => x + '=?').join(',') + ', updated_at=? WHERE id=?', ...k.map((x) => f[x]), now(), id); }
async function setLane(env, id, f) { const k = Object.keys(f); await run(env, 'UPDATE lanes SET ' + k.map((x) => x + '=?').join(',') + ' WHERE id=?', ...k.map((x) => f[x]), id); }

// Token ledger: every AI call is counted against its request (and its rider).
async function addTokens(env, id, laneId, t) {
  if (!t || !t.calls) return;
  await run(env, 'UPDATE intents SET tokens_in=COALESCE(tokens_in,0)+?, tokens_out=COALESCE(tokens_out,0)+?, ai_calls=COALESCE(ai_calls,0)+? WHERE id=?', t.in, t.out, t.calls, id);
  if (laneId) await run(env, 'UPDATE lanes SET tokens=COALESCE(tokens,0)+? WHERE id=?', t.in + t.out, laneId);
}

/* ---------------- AI ---------------- */
function textOf(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const c = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
  if (c) return c;
  if (Array.isArray(r.output)) for (const o of r.output) for (const p of (o.content || [])) if (p.text) return p.text;
  return '';
}
async function ai(env, m, messages, o = {}) {
  const opts = { messages, max_tokens: o.max || m.max, temperature: o.temp ?? 0.3 };
  if (m.model.includes('gpt-oss')) opts.reasoning_effort = 'low';
  let r;
  try { r = await env.AI.run(m.model, opts); }
  catch (e) { if (opts.reasoning_effort) { delete opts.reasoning_effort; r = await env.AI.run(m.model, opts); } else throw e; }
  const text = textOf(r);
  if (o.track) {
    const u = (r && r.usage) || {};
    o.track.in += u.prompt_tokens || Math.round(JSON.stringify(messages).length / 4);
    o.track.out += u.completion_tokens || Math.round(text.length / 4);
    o.track.calls++;
  }
  return text;
}
function parseJson(t) { const s = t.indexOf('{'), e = t.lastIndexOf('}'); if (s < 0 || e < s) return null; try { return JSON.parse(t.slice(s, e + 1)); } catch (x) { return null; } }
const editable = (p) => !p.startsWith('.rodeo/') && p !== 'README.md';

function riderMessages(ask, files) {
  const sys = 'You are a rider in Rodeo, where several AI agents race to make the same change to a small website. A business owner wrote the request in plain English. Make exactly the change they asked for and nothing else. Every part of the request must be visible to a visitor on the page, not only stored in the data (for example, a sale should show the word Sale next to the item). Keep everything that works today working. Do not add or rename files. Do not remove the script that loads menu.json. In menu.json every item needs a "name" (text), a "price" (number) and a "note" (text, can be empty).\n\nReply in this exact format and nothing else:\n<<<FILE path>>>\n(the complete new content of that file)\n<<<END>>>\nOnly include FILE blocks for files you changed. Finish with:\n<<<NOTE>>>one short sentence about what you changed<<<END>>>';
  const user = 'Request from the owner:\n"' + ask + '"\n\nFiles:\n\n' + Object.keys(files).filter(editable).map((p) => '<<<FILE ' + p + '>>>\n' + files[p] + '\n<<<END>>>').join('\n\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}
function parseRider(text, files) {
  const out = {}; const re = /<<<FILE\s+([^>\n]+?)>>>\s*\n([\s\S]*?)\n?<<<END>>>/g; let m;
  while ((m = re.exec(text))) { const p = m[1].trim(); if (p in files && editable(p)) out[p] = m[2].replace(/^```[a-z]*\n/, '').replace(/\n```\s*$/, ''); }
  const n = /<<<NOTE>>>([\s\S]*?)<<<END>>>/.exec(text);
  return { changes: out, note: n ? n[1].trim().slice(0, 240) : '' };
}
function linesChanged(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n'); const cnt = new Map();
  for (const l of A) cnt.set(l, (cnt.get(l) || 0) + 1);
  let added = 0; for (const l of B) { const c = cnt.get(l) || 0; if (c > 0) cnt.set(l, c - 1); else added++; }
  let removed = 0; for (const v of cnt.values()) removed += v;
  return added + removed;
}
function gates(before, after, changed) {
  const f = [];
  if (!changed.length) f.push('Changed nothing');
  for (const p of changed) {
    const a = after[p];
    if (p.endsWith('.json')) {
      try { const j = JSON.parse(a); if (p === 'menu.json' && !(Array.isArray(j) && j.every((i) => i && typeof i.name === 'string' && typeof i.price === 'number'))) f.push('menu.json items need a name and a numeric price'); }
      catch (e) { f.push(p + ' is not valid JSON'); }
    }
    if (before[p] && a.length < before[p].length * 0.4) f.push(p + ' lost most of its content');
  }
  const bi = before['index.html'], ai2 = after['index.html'];
  if (bi && ai2 && bi.includes('menu.json') && !ai2.includes('menu.json')) f.push('Site no longer loads the menu');
  if (ai2 && !/<\/html>/i.test(ai2)) f.push('index.html is cut off');
  return f;
}
async function buildChange(env, R, ask, files, track) {
  const t = await ai(env, R, riderMessages(ask, files), { temp: 0.4, track });
  const { changes, note } = parseRider(t, files);
  const out = { ...files }; const changed = [];
  for (const [p, c0] of Object.entries(changes)) { let c = c0; if (files[p].endsWith('\n') && !c.endsWith('\n')) c += '\n'; if (c !== files[p]) { out[p] = c; changed.push(p); } }
  let lines = 0; for (const p of changed) lines += linesChanged(files[p], out[p]);
  return { files: out, changed, lines, note, fails: gates(files, out, changed) };
}
async function judge(env, ask, checks, before, after, changed, track) {
  const msgs = [
    { role: 'system', content: 'You are the judge in Rodeo. You decide whether a change to a small website did what the business owner asked. Be strict and literal. Reply with JSON only.' },
    { role: 'user', content: 'Owner request: "' + ask + '"\n\nChecks:\n' + checks.map((c, i) => (i + 1) + '. ' + c).join('\n') + '\n\n' + changed.map((p) => '--- ' + p + ' BEFORE ---\n' + (before[p] ?? '(new file)') + '\n--- ' + p + ' AFTER ---\n' + after[p]).join('\n\n') + '\n\nReturn JSON: {"results":[{"pass":true,"why":"short reason"}],"unrequested":false,"extra":""}. results must have exactly ' + checks.length + ' items, in the same order as the checks. Set unrequested to true only if the AFTER files add or change something the owner did not ask for, and describe it in extra. Things that are missing are not unrequested; they are failed checks.' },
  ];
  let j = null;
  for (const J of [JUDGE, RIDERS[0]]) { try { j = parseJson(await ai(env, J, msgs, { temp: 0, track })); } catch (e) { j = null; } if (j && Array.isArray(j.results)) { j.by = J.name; break; } j = null; }
  if (!j) return { passed: 0, score: 0, results: checks.map((c) => ({ check: c, pass: false, why: 'The judge could not read this change.' })), extra: '', by: 'none' };
  const results = checks.map((c, i) => ({ check: c, pass: !!(j.results[i] && j.results[i].pass === true), why: String((j.results[i] && j.results[i].why) || '').slice(0, 200) }));
  const passed = results.filter((r) => r.pass).length;
  const extra = String(j.extra || '').slice(0, 200);
  const pen = j.unrequested === true ? 10 : 0;
  return { passed, score: Math.max(0, Math.round((100 * passed) / checks.length) - pen), results, extra: pen ? extra : '', by: j.by };
}
async function draftChecks(env, ask, track) {
  try {
    const t = await ai(env, RIDERS[0], [
      { role: 'system', content: 'Turn a business owner\'s website request into 2 to 4 short checks a person could verify by looking at the website. One plain sentence each. The last check must be that nothing else on the page changed. Reply with a JSON array of strings only.' },
      { role: 'user', content: ask }], { max: 400, temp: 0, track });
    const a = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)).filter((x) => typeof x === 'string' && x.trim()).slice(0, 5);
    if (a.length) return a;
  } catch (e) {}
  return [ask, 'Nothing else on the page changed.'];
}

/* ---------------- The race ---------------- */
async function startIntent(env, id) {
  const it = await one(env, 'SELECT * FROM intents WHERE id=?', id);
  if (!it || it.status !== 'queued') return;
  let checks = JSON.parse(it.checks || '[]');
  if (!checks.length) { await setIntent(env, id, { status: 'drafting' }); await evt(env, id, 'Writing checks from the request.'); const t0 = { in: 0, out: 0, calls: 0 }; checks = await draftChecks(env, it.ask, t0); await addTokens(env, id, null, t0); }
  const base = await snapshot(env, REPO, 'main');
  await setIntent(env, id, { status: 'racing', checks: JSON.stringify(checks), base_commit: base.commit });
  const addLane = async (R) => { const r = await run(env, 'INSERT INTO lanes(intent_id,slot,rider,model,stage) VALUES(?,?,?,?,?)', id, R.slot, R.name, R.model, 'waiting'); return { id: r.meta.last_row_id, ...R }; };
  if (it.mode === 'full') {
    // Full race: every rider at once.
    await evt(env, id, 'Starting line: main at ' + base.commit.slice(0, 7) + '. ' + checks.length + ' checks. Full race: ' + RIDERS.length + ' riders at once.');
    const lanes = []; for (const R of RIDERS) lanes.push(await addLane(R));
    await Promise.allSettled(lanes.map((L) => rideLane(env, it, checks, L, base)));
  } else {
    // Smart race: one rider first. The others only ride if it misses a check.
    await evt(env, id, 'Starting line: main at ' + base.commit.slice(0, 7) + '. ' + checks.length + ' checks. Smart race: one rider first, more only if needed.');
    const first = await addLane(RIDERS[0]);
    await rideLane(env, it, checks, first, base);
    const l1 = await one(env, 'SELECT * FROM lanes WHERE id=?', first.id);
    if (l1 && l1.stage === 'done' && l1.passed === l1.total) {
      await evt(env, id, RIDERS[0].name + ' passed every check on its own. The other ' + (RIDERS.length - 1) + ' riders stayed in the barn and used no tokens.');
    } else {
      await evt(env, id, RIDERS[0].name + (l1 && l1.stage === 'done' ? ' passed ' + l1.passed + '/' + l1.total + ' checks.' : ' fell off.') + ' Sending in ' + (RIDERS.length - 1) + ' more riders.');
      const rest = []; for (const R of RIDERS.slice(1)) rest.push(await addLane(R));
      await Promise.allSettled(rest.map((L) => rideLane(env, it, checks, L, base)));
    }
  }
  await finalize(env, id);
}
async function rideLane(env, it, checks, L, base) {
  const fork = REPO + '--i' + it.id + '-r' + L.slot; const branch = 'rodeo/i' + it.id;
  const tk = { in: 0, out: 0, calls: 0 };
  try {
    await setLane(env, L.id, { stage: 'fork', started_at: now(), fork });
    const acc = await forkFor(env, fork);
    await setLane(env, L.id, { stage: 'build' });
    const res = await buildChange(env, L, it.ask, base.files, tk);
    if (!res.changed.length) throw new Error('Changed nothing');
    await setLane(env, L.id, { stage: 'push', note: res.note, changed_paths: JSON.stringify(res.changed), lines_changed: res.lines });
    const p = await pushRetry({ remote: acc.remote, token: acc.token, branch, files: res.files, parent: base.commit, message: it.ask + '\n\nRodeo-Intent: ' + it.id + '\nRodeo-Rider: ' + L.name, author: { name: 'Rodeo ' + L.name, email: 'rider' + L.slot + '@rodeo.local' } });
    await setLane(env, L.id, { stage: 'judge', commit_hash: p.commit });
    await evt(env, it.id, L.name + ' pushed ' + p.commit.slice(0, 7) + ' to its own fork (' + res.changed.join(', ') + ').');
    if (res.fails.length) {
      await setLane(env, L.id, { stage: 'out', score: 0, passed: 0, total: checks.length, error: res.fails.join('; '), finished_at: now() });
      await evt(env, it.id, L.name + ' is out: ' + res.fails.join('; ') + '.');
      return;
    }
    const j = await judge(env, it.ask, checks, base.files, res.files, res.changed, tk);
    await setLane(env, L.id, { stage: 'done', score: j.score, passed: j.passed, total: checks.length, results: JSON.stringify(j), finished_at: now() });
    await evt(env, it.id, 'Judge scored ' + L.name + ': ' + j.passed + '/' + checks.length + ' checks.');
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    await setLane(env, L.id, { stage: 'out', error: msg, score: 0, passed: 0, total: checks.length, finished_at: now() });
    await evt(env, it.id, L.name + ' fell off: ' + msg.slice(0, 120));
  } finally { await addTokens(env, it.id, L.id, tk); }
}
async function finalize(env, id) {
  const it = await one(env, 'SELECT * FROM intents WHERE id=?', id);
  if (!it || it.status !== 'racing') return;
  const lanes = await all(env, 'SELECT * FROM lanes WHERE intent_id=? ORDER BY slot', id);
  const done = lanes.filter((l) => l.stage === 'done').sort((a, b) => b.score - a.score || a.lines_changed - b.lines_changed || a.finished_at - b.finished_at);
  const w = done[0];
  if (!w || w.score < 50) { await setIntent(env, id, { status: 'no_winner' }); await evt(env, id, 'No rider passed enough checks. The live site was not touched.'); return; }
  await setIntent(env, id, { status: 'awaiting_owner', winner_lane: w.id, changed_paths: w.changed_paths });
  await evt(env, id, 'Winner: ' + w.rider + ' with ' + w.passed + '/' + w.total + ' checks and ' + w.lines_changed + ' lines changed. Waiting for your YES.');
}
function intentDoc(it, checks, results, lanes, winnerName, replayed) {
  const res = (results && results.results) || [];
  return ['# Request ' + it.id, '', '> ' + it.ask, '', 'Asked: ' + new Date(it.created_at).toISOString(), '', '## Checks',
    ...checks.map((c, i) => '- [' + (res[i] && res[i].pass ? 'x' : ' ') + '] ' + c + (res[i] && res[i].why ? ' (judge: ' + res[i].why + ')' : '')),
    '', '## The race',
    ...lanes.map((l) => '- ' + l.rider + ': ' + (l.stage === 'done' ? l.passed + '/' + l.total + ' checks, ' + l.lines_changed + ' lines changed' : 'out' + (l.error ? ' (' + l.error + ')' : '')) + (l.rider === winnerName ? ' (winner)' : '')),
    '', '## Result', 'Built by: ' + winnerName, 'Replayed on newer code: ' + (replayed ? 'yes' : 'no'), 'Approved by: the owner, ' + new Date().toISOString(), ''].join('\n');
}
async function mergeIntent(env, id) {
  const it = await one(env, 'SELECT * FROM intents WHERE id=?', id);
  if (!it || it.status !== 'merging') return;
  const checks = JSON.parse(it.checks);
  const lanes = await all(env, 'SELECT * FROM lanes WHERE intent_id=? ORDER BY slot', id);
  const w = lanes.find((l) => l.id === it.winner_lane);
  const won = await snapshot(env, w.fork, 'rodeo/i' + id);
  const base = await snapshot(env, REPO, it.base_commit);
  const changed = JSON.parse(w.changed_paths || '[]');
  for (let attempt = 0; attempt < 4; attempt++) {
    const h = await snapshot(env, REPO, 'main');
    let files, rider = w.rider, results = JSON.parse(w.results || '{}'), replayed = false, changedNow = changed;
    if (h.commit === it.base_commit) files = { ...won.files };
    else {
      const moved = [...new Set([...Object.keys(base.files), ...Object.keys(h.files)])].filter((p) => editable(p) && base.files[p] !== h.files[p]);
      const overlap = changed.filter((p) => moved.includes(p));
      if (!overlap.length) {
        files = { ...h.files }; for (const p of changed) files[p] = won.files[p];
        await evt(env, id, 'Main moved to ' + h.commit.slice(0, 7) + ', but only in ' + (moved.join(', ') || 'request records') + '. No overlap, clean merge.');
      } else {
        await setIntent(env, id, { status: 'replaying' });
        await evt(env, id, 'Main moved to ' + h.commit.slice(0, 7) + ' and changed ' + overlap.join(', ') + ' too. Replaying the request on the new code instead of forcing the old patch.');
        const order = [w, ...lanes.filter((l) => l.stage === 'done' && l.id !== w.id).sort((a, b) => b.score - a.score)];
        let got = null; const tr = { in: 0, out: 0, calls: 0 };
        for (const L of order) {
          const R = RIDERS.find((r) => r.slot === L.slot);
          const res = await buildChange(env, R, it.ask, h.files, tr);
          if (res.fails.length) { await evt(env, id, 'Replay by ' + R.name + ' failed the safety gates: ' + res.fails.join('; ') + '.'); continue; }
          const j = await judge(env, it.ask, checks, h.files, res.files, res.changed, tr);
          await evt(env, id, 'Replay by ' + R.name + ': ' + j.passed + '/' + checks.length + ' checks on the new code.');
          if (j.passed >= w.passed) { got = { res, j, L }; break; }
        }
        await addTokens(env, id, null, tr);
        if (!got) { await setIntent(env, id, { status: 'replay_failed' }); await evt(env, id, 'No rider could rebuild this request on the new code and pass the same checks. The live site was not touched.'); return; }
        files = got.res.files; rider = got.L.rider; results = got.j; replayed = true; changedNow = got.res.changed;
        await setIntent(env, id, { status: 'merging' });
      }
    }
    files['.rodeo/intents/' + id + '.md'] = intentDoc(it, checks, results, lanes, rider, replayed);
    const acc = await writeAccess(env, REPO);
    try {
      const p = await pushSnapshot({ remote: acc.remote, token: acc.token, branch: 'main', files, parent: h.commit, expectOld: h.commit,
        message: it.ask + '\n\nRodeo-Intent: ' + id + '\nRodeo-Rider: ' + rider + '\nRodeo-Checks: ' + (results.passed ?? w.passed) + '/' + checks.length + ' passed\nRodeo-Replayed: ' + (replayed ? 'yes' : 'no') + '\nRodeo-Approved-By: owner',
        author: { name: 'Rodeo ' + rider, email: 'rodeo@rodeo.local' } });
      await setIntent(env, id, { status: 'merged', merged_commit: p.commit, merged_parent: h.commit, changed_paths: JSON.stringify(changedNow), replayed: replayed ? 1 : 0, note: rider });
      await evt(env, id, 'Merged to main as ' + p.commit.slice(0, 7) + '. Live now.' + (replayed ? ' (Rebuilt by ' + rider + ' on the newer code.)' : ''));
      for (const l of lanes) await dropRepo(env, l.fork);
      return;
    } catch (e) {
      if (/stale|rejected/i.test(String(e))) { await evt(env, id, 'Another request merged first. Checking again.'); continue; }
      throw e;
    }
  }
  throw new Error('Could not merge after 4 tries');
}
async function undoIntent(env, id) {
  const it = await one(env, 'SELECT * FROM intents WHERE id=?', id);
  if (!it || it.status !== 'undoing') return;
  const changed = JSON.parse(it.changed_paths || '[]');
  const [m, p] = await Promise.all([snapshot(env, REPO, it.merged_commit), snapshot(env, REPO, it.merged_parent)]);
  for (let a = 0; a < 4; a++) {
    const h = await snapshot(env, REPO, 'main');
    const files = { ...h.files }; const skipped = []; const restored = [];
    for (const f of changed) { if (h.files[f] === m.files[f]) { if (f in p.files) files[f] = p.files[f]; else delete files[f]; restored.push(f); } else skipped.push(f); }
    if (!restored.length) { await setIntent(env, id, { status: 'merged' }); await evt(env, id, 'Can\'t undo: later requests changed ' + skipped.join(', ') + '. Send a new request instead.'); return; }
    const doc = '.rodeo/intents/' + id + '.md';
    if (files[doc]) files[doc] += '\nUndone by the owner: ' + new Date().toISOString() + '\n';
    const acc = await writeAccess(env, REPO);
    try {
      const r = await pushSnapshot({ remote: acc.remote, token: acc.token, branch: 'main', files, parent: h.commit, expectOld: h.commit, message: 'Undo: ' + it.ask + '\n\nRodeo-Intent: ' + id + '\nRodeo-Action: undo' });
      await setIntent(env, id, { status: 'undone' });
      await evt(env, id, 'Undone as ' + r.commit.slice(0, 7) + '. Restored ' + restored.join(', ') + '.' + (skipped.length ? ' Kept ' + skipped.join(', ') + ' because a later request changed it.' : ''));
      return;
    } catch (e) { if (/stale|rejected/i.test(String(e))) continue; throw e; }
  }
  throw new Error('Could not undo after 4 tries');
}
async function job(env, b) {
  if (b.kind === 'start') return startIntent(env, b.id);
  if (b.kind === 'merge') return mergeIntent(env, b.id);
  if (b.kind === 'undo') return undoIntent(env, b.id);
}

/* ---------------- HTTP ---------------- */
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const MIME = { html: 'text/html; charset=utf-8', json: 'application/json', css: 'text/css', js: 'text/javascript', md: 'text/markdown; charset=utf-8', svg: 'image/svg+xml', png: 'image/png' };
async function routeReq(req, env, ctx) {
  const url = new URL(req.url); const P = url.pathname;
  if (url.hostname === 'www.airodeo.dev') return Response.redirect('https://airodeo.dev' + P + url.search, 301);
  if (P === '/' || P === '/index.html') return new Response(APP, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if (P === '/health') return json({ ok: true, repo: REPO });
  if (P.startsWith('/p/')) {
    const seg = P.split('/').slice(2); const repo = decodeURIComponent(seg[0] || ''); const ref = decodeURIComponent(seg[1] || 'main');
    const path = seg.slice(2).map(decodeURIComponent).join('/') || 'index.html';
    if (!/^barn-coffee(--i\d+-r\d)?$/.test(repo)) return new Response('Not found', { status: 404 });
    try {
      const buf = await withRepo(env, repo, async (r) => { const b = await r.readFile({ ref, path }); return b ? await b.arrayBuffer() : null; });
      if (!buf) return new Response('Not found', { status: 404 });
      return new Response(buf, { headers: { 'content-type': MIME[path.split('.').pop()] || 'text/plain; charset=utf-8', 'content-security-policy': 'sandbox allow-scripts', 'access-control-allow-origin': '*', 'cache-control': /^[0-9a-f]{40}$/.test(ref) ? 'public, max-age=86400' : 'no-store' } });
    } catch (e) { return new Response('This preview is gone. Its fork was cleaned up after the owner decided.', { status: 404 }); }
  }
  if (P === '/api/state') {
    const intents = await all(env, 'SELECT id,ask,status,replayed,mode,tokens_in,tokens_out,ai_calls,created_at,updated_at FROM intents ORDER BY id DESC LIMIT 30');
    const ids = intents.map((i) => i.id);
    const lanes = ids.length ? await all(env, 'SELECT intent_id,slot,stage,passed,total FROM lanes WHERE intent_id IN (' + ids.map(() => '?').join(',') + ')', ...ids) : [];
    for (const i of intents) i.lanes = lanes.filter((l) => l.intent_id === i.id);
    return json({ intents });
  }
  if (P === '/api/ledger') {
    const log = await withRepo(env, REPO, (r) => r.log({ ref: 'main', limit: 40 }));
    return json({ commits: log.map((c) => ({ hash: c.hash, message: c.message, at: c.committedAt * 1000, author: c.author && c.author.name })) });
  }
  let m = P.match(/^\/api\/intents\/(\d+)$/);
  if (m && req.method === 'GET') {
    const id = +m[1]; const it = await one(env, 'SELECT * FROM intents WHERE id=?', id);
    if (!it) return json({ error: 'Not found' }, 404);
    it.checks = JSON.parse(it.checks || '[]');
    const lanes = await all(env, 'SELECT * FROM lanes WHERE intent_id=? ORDER BY slot', id);
    for (const l of lanes) { l.results = l.results ? JSON.parse(l.results) : null; l.changed_paths = l.changed_paths ? JSON.parse(l.changed_paths) : []; }
    const events = await all(env, 'SELECT at,text FROM events WHERE intent_id=? ORDER BY id', id);
    return json({ intent: it, lanes, events, judge: JUDGE.name });
  }
  if (req.method === 'POST' && P.startsWith('/api/')) {
    if ((req.headers.get('x-rodeo-pin') || '') !== (env.RODEO_PIN || '')) return json({ error: 'pin' }, 401);
    if (P === '/api/intents') {
      const b = await req.json().catch(() => ({}));
      const ask = String(b.ask || '').replace(/\s+/g, ' ').trim();
      if (ask.length < 4 || ask.length > 500) return json({ error: 'Write the request in 4 to 500 characters.' }, 400);
      const checks = (Array.isArray(b.checks) ? b.checks : []).map((c) => String(c).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
      const c = await one(env, 'SELECT COUNT(*) n FROM intents WHERE created_at>?', now() - 86400000);
      if (c.n >= 80) return json({ error: 'The demo has hit its daily limit. Try again tomorrow.' }, 429);
      const t = now();
      const mode = b.mode === 'full' ? 'full' : 'smart';
      const r = await run(env, 'INSERT INTO intents(repo,ask,checks,status,created_at,updated_at,mode) VALUES(?,?,?,?,?,?,?)', REPO, ask, JSON.stringify(checks), 'queued', t, t, mode);
      const id = r.meta.last_row_id;
      await evt(env, id, 'Request received.');
      await env.JOBS.send({ kind: 'start', id });
      return json({ id });
    }
    if (P === '/api/setup') {
      // One-time setup: create the demo repo in your Artifacts namespace and push the starting site.
      let exists = true;
      try { await withRepo(env, REPO, (r) => r.info()); } catch (e) { exists = false; }
      if (!exists) await env.ARTIFACTS.create(REPO, { setDefaultBranch: 'main', description: 'Rodeo demo site' });
      let acc, last;
      for (let i = 0; i < 20 && !acc; i++) { try { acc = await writeAccess(env, REPO); } catch (e) { last = e; await sleep(750); } }
      if (!acc) throw last;
      const refs = await remoteRefs(acc.remote, acc.token);
      if (refs['refs/heads/main']) return json({ ok: true, note: 'Already set up.' });
      const p = await pushSnapshot({ remote: acc.remote, token: acc.token, branch: 'main', files: SEED, message: 'Barn Coffee starting site', expectOld: null });
      return json({ ok: true, commit: p.commit });
    }
    if (P === '/api/reset') {
      const log = await withRepo(env, REPO, (r) => r.log({ ref: 'main', limit: 1000 }));
      const first = log[log.length - 1];
      const start = await snapshot(env, REPO, first.hash);
      const h = await snapshot(env, REPO, 'main');
      const files = { ...start.files };
      for (const p of Object.keys(h.files)) if (p.startsWith('.rodeo/')) files[p] = h.files[p];
      const acc = await writeAccess(env, REPO);
      const p = await pushSnapshot({ remote: acc.remote, token: acc.token, branch: 'main', files, parent: h.commit, expectOld: h.commit, message: 'Reset Barn Coffee to the starting site\n\nRodeo-Action: reset' });
      return json({ ok: true, commit: p.commit });
    }
    m = P.match(/^\/api\/intents\/(\d+)\/(yes|no|undo)$/);
    if (m) {
      const id = +m[1]; const act = m[2];
      if (act === 'yes') {
        const r = await run(env, "UPDATE intents SET status='merging', updated_at=? WHERE id=? AND status='awaiting_owner'", now(), id);
        if (!r.meta.changes) return json({ error: 'This request is not waiting for a decision.' }, 409);
        await evt(env, id, 'The owner said YES.'); await env.JOBS.send({ kind: 'merge', id }); return json({ ok: true });
      }
      if (act === 'no') {
        const r = await run(env, "UPDATE intents SET status='rejected', updated_at=? WHERE id=? AND status IN ('awaiting_owner','no_winner','replay_failed')", now(), id);
        if (!r.meta.changes) return json({ error: 'This request can no longer be turned down.' }, 409);
        await evt(env, id, 'The owner said NO. The live site was not touched.');
        const lanes = await all(env, 'SELECT fork FROM lanes WHERE intent_id=?', id);
        ctx.waitUntil(Promise.all(lanes.map((l) => dropRepo(env, l.fork))));
        return json({ ok: true });
      }
      if (act === 'undo') {
        const r = await run(env, "UPDATE intents SET status='undoing', updated_at=? WHERE id=? AND status='merged' AND updated_at>?", now(), id, now() - 7 * 86400000);
        if (!r.meta.changes) return json({ error: 'Undo works for 7 days after a merge.' }, 409);
        await evt(env, id, 'The owner asked to UNDO.'); await env.JOBS.send({ kind: 'undo', id }); return json({ ok: true });
      }
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req, env, ctx) { try { return await routeReq(req, env, ctx); } catch (e) { return json({ error: String((e && e.message) || e) }, 500); } },
  async queue(batch, env) {
    await Promise.allSettled(batch.messages.map(async (msg) => {
      try { await job(env, msg.body); }
      catch (e) { try { await evt(env, msg.body.id, 'Error: ' + String((e && e.message) || e).slice(0, 200)); await setIntent(env, msg.body.id, { status: 'error' }); } catch (x) {} }
      msg.ack();
    }));
  },
};

/* ---------------- The app ---------------- */
const APP = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#3b2414" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15120e" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>AI Rodeo · the request is the commit</title>
<link rel="canonical" href="https://airodeo.dev/">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A4%A0%3C/text%3E%3C/svg%3E">
<meta name="description" content="Rodeo: AI agents race to build the same plain-English request on their own Cloudflare Artifacts forks. A judge scores them. The owner says yes.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Caveat:wght@600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--paper:#f5efe4;--sheet:#fffdf8;--ink:#1f1a14;--muted:#776b5d;--line:#e3d8c6;--rust:#b8471c;--denim:#2c5d86;--sage:#5b7d2a;--ok:#2e7d32;--bad:#b42318;--gold:#c9962b;--r:14px;--slab:"Zilla Slab",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--paper:#15120e;--sheet:#1f1a15;--ink:#f2e9dc;--muted:#a3957f;--line:#3a3128;--rust:#e0703f;--denim:#6aa2d4;--sage:#94b860;--gold:#d9a93c}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 var(--sans);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
body{padding:env(safe-area-inset-top) 0 calc(64px + env(safe-area-inset-bottom))}
body.decide-on{padding-bottom:calc(140px + env(safe-area-inset-bottom))}
.top{max-width:640px;margin:0 auto;padding:18px 20px 4px;display:flex;align-items:baseline;gap:10px}
.brand{font:700 30px/1 var(--slab);color:var(--rust);text-decoration:none;letter-spacing:.3px}
.sub{font-size:13px;color:var(--muted)}
main{max-width:640px;margin:0 auto;padding:0 16px 24px}
h2{font:700 20px/1.2 var(--slab);margin:28px 0 8px}
h3{font:600 16px/1.3 var(--sans);margin:22px 0 6px}
p{margin:8px 0}
a{color:var(--rust)}
.muted{color:var(--muted)}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;background:color-mix(in srgb,var(--sheet) 90%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
.tabs a{flex:1;position:relative;text-align:center;padding:15px 0 14px;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none}
.tabs a.on{color:var(--ink)}
.tabs a.on::before{content:"";position:absolute;top:0;left:30%;right:30%;height:3px;border-radius:0 0 3px 3px;background:var(--rust)}
.composer{background:var(--sheet);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-top:14px}
.composer label{display:block;font:600 15px var(--sans);margin-bottom:8px}
textarea,input{width:100%;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);font:16px/1.4 var(--sans);padding:12px}
textarea{resize:vertical;min-height:84px}
textarea:focus,input:focus,button:focus-visible,a:focus-visible{outline:2px solid var(--rust);outline-offset:2px}
.chips{display:flex;gap:8px;overflow-x:auto;margin:12px -16px 0;padding:0 16px 2px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:8px 12px;font:500 13px var(--sans);cursor:pointer}
details{margin-top:12px;font-size:14px}
summary{cursor:pointer;color:var(--muted);font-weight:600}
details textarea{margin-top:8px;min-height:70px;font-size:15px}
.btn{appearance:none;border:0;border-radius:12px;padding:14px 16px;font:600 16px var(--sans);background:var(--rust);color:#fff;width:100%;cursor:pointer;margin-top:12px}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn:disabled{opacity:.5}
.err{color:var(--bad);font-size:14px;margin-top:8px}
a.req{display:block;padding:14px 2px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.req .ask{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:var(--muted)}
.num{font:500 12px var(--mono)}
.st{font:700 11px/1 var(--sans);letter-spacing:.04em;text-transform:uppercase;padding:5px 8px;border-radius:999px;background:var(--line);color:var(--ink)}
.st.live{background:var(--ok);color:#fff}.st.call{background:var(--gold);color:#1f1a14}.st.run{background:var(--denim);color:#fff}.st.bad{background:var(--bad);color:#fff}
.pips{margin-left:auto;display:flex;gap:4px}
.pips i{width:8px;height:8px;border-radius:50%;background:var(--line)}
.pips i.d1{background:var(--rust)}.pips i.d2{background:var(--denim)}.pips i.d3{background:var(--sage)}.pips i.x{background:transparent;box-shadow:inset 0 0 0 1.5px var(--muted)}
.back{display:inline-block;margin-top:10px;font-size:14px;font-weight:600;text-decoration:none}
.quote{font:600 24px/1.25 var(--slab);margin:12px 0 6px}
.statusline{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)}
.lane{--c:var(--muted);padding:12px 8px;margin:0 -8px;border-bottom:1px solid var(--line);border-radius:10px;cursor:pointer}
.l1{--c:var(--rust)}.l2{--c:var(--denim)}.l3{--c:var(--sage)}
.lane.sel{background:color-mix(in srgb,var(--c) 9%,transparent)}
.lhead{display:flex;align-items:center;gap:8px;font-size:15px}
.lhead b{font-weight:600}
.lhead .score{margin-left:auto;font:500 14px var(--mono)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--c);flex:none}
.ribbon{font:700 10px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;background:var(--gold);color:#1f1a14;padding:4px 7px;border-radius:999px}
.track{position:relative;height:30px;margin:10px 0 2px}
.rail,.fill{position:absolute;left:0;top:13px;height:4px;border-radius:2px}
.rail{right:22px;background:var(--line)}
.fill{background:var(--c);transition:width .6s ease}
.finish{position:absolute;right:0;top:3px;width:18px;height:24px;border-radius:3px;background:repeating-conic-gradient(var(--ink) 0 25%,var(--sheet) 0 50%) 0 0/9px 8px;opacity:.85}
.puck{position:absolute;top:4px;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:var(--c);color:#fff;font:700 12px/22px var(--sans);text-align:center;transition:left .6s ease;box-shadow:0 0 0 3px var(--paper)}
.moving .puck{animation:bob .9s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-3px)}}
.lane.out .puck,.lane.out .fill{background:var(--muted)}
.stops{display:flex;justify-content:space-between;padding-right:22px;font:600 10px/1 var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.lnote{font-size:13px;color:var(--muted);margin-top:6px}
.seg{display:flex;background:var(--line);border-radius:10px;padding:3px;gap:3px}
.seg button{flex:1;border:0;background:transparent;padding:9px;border-radius:8px;font:600 14px var(--sans);color:var(--ink);cursor:pointer}
.seg button.on{background:var(--sheet);box-shadow:0 1px 2px rgba(0,0,0,.14)}
.frame{margin-top:10px;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:#fff;height:460px}
.frame iframe{width:100%;height:100%;border:0;display:block}
.cap{font-size:13px;color:var(--muted);margin-top:6px;display:flex;justify-content:space-between;gap:8px}
ul.checks{list-style:none;padding:0;margin:0}
.checks li{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:15px}
.mark{flex:none;width:22px;height:22px;border-radius:50%;font:700 12px/22px var(--sans);text-align:center;background:var(--line);color:var(--ink)}
.mark.p{background:var(--ok);color:#fff}.mark.f{background:var(--bad);color:#fff}
.why{display:block;font-size:13px;color:var(--muted)}
.log div{padding:7px 0;border-bottom:1px dashed var(--line);font-size:14px}
.log time{font:500 12px var(--mono);color:var(--muted);margin-right:8px}
.git{font:500 12px/1.7 var(--mono);color:var(--muted);word-break:break-all;margin-top:6px}
.decide{position:fixed;left:0;right:0;bottom:calc(49px + env(safe-area-inset-bottom));z-index:5;background:color-mix(in srgb,var(--paper) 92%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:10px 16px 12px}
.decide .inner{max-width:640px;margin:0 auto}
.decide .q{font-size:13px;color:var(--muted);margin-bottom:8px}
.decide .row{display:flex;gap:10px}
.decide .btn{margin:0}
.decide .btn.ghost{flex:0 0 34%}
.commit{padding:12px 0;border-bottom:1px solid var(--line)}
.commit .t{font-weight:600}
.tag{font:700 10px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:4px 6px;border-radius:6px;background:var(--line);color:var(--ink)}
.tag.rp{background:var(--denim);color:#fff}.tag.ud{background:var(--bad);color:#fff}
.empty{color:var(--muted);font-size:14px;padding:18px 0}
.how ol{padding-left:20px}.how li{margin:8px 0}
.pin{position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.4);display:none;align-items:flex-end;justify-content:center}
.pin.on{display:flex}
.pin .box{background:var(--sheet);width:100%;max-width:640px;border-radius:18px 18px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom))}
@media (prefers-reduced-motion:reduce){.puck,.fill{transition:none}.moving .puck{animation:none}}
/* v2 design: barn hero, request card, icon tabs */
:root{--slab:"Fraunces",Georgia,serif;--green:#2f6a35}
@media (prefers-color-scheme:dark){:root{--green:#4f8f55}}
body{padding-top:0;padding-bottom:calc(80px + env(safe-area-inset-bottom))}
body.decide-on{padding-bottom:calc(170px + env(safe-area-inset-bottom))}
.hero{position:relative;overflow:hidden;color:#fbf4e8;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;background:radial-gradient(90% 80% at 100% 35%,rgba(255,212,150,.55),rgba(255,190,120,0) 60%),linear-gradient(90deg,rgba(22,13,6,.94) 0%,rgba(22,13,6,.72) 48%,rgba(22,13,6,.28) 100%),repeating-linear-gradient(90deg,#5b3920 0 54px,#3a2312 54px 57px,#6a4427 57px 112px,#352010 112px 115px,#55361e 115px 170px,#2f1c0e 170px 173px)}
.hero .bar{max-width:640px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
.round{width:46px;height:46px;border-radius:50%;border:0;background:#f6efe3;color:#2a1c12;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3)}
.logo{text-align:center;text-decoration:none;color:#fbf4e8;line-height:1}
.logo svg{display:block;margin:0 auto -3px}
.logo b{font:700 36px/1 var(--slab);letter-spacing:-.5px}
.logo small{display:block;margin-top:7px;font:600 9px/1 var(--sans);letter-spacing:.34em;text-transform:uppercase;opacity:.85}
.hero .copy{display:none;max-width:640px;margin:0 auto;position:relative;padding:20px 2px 70px;min-height:290px}
body.home .hero .copy{display:block}
body.home .hero{padding-bottom:0}
.hero h1{font:700 36px/1.02 var(--slab);margin:0;max-width:9.5ch;letter-spacing:-.6px;position:relative;z-index:1}
.hero p{margin:12px 0 0;font-size:16px;line-height:1.35;max-width:21ch;opacity:.93;position:relative;z-index:1}
.hero .art{position:absolute;right:-6px;bottom:40px;width:44%;max-width:230px}
.hero .script{position:absolute;right:4px;top:12px;font:600 23px/.92 "Caveat",cursive;transform:rotate(-8deg);text-align:center;opacity:.95}
.hero .script::after{content:"";display:block;height:2px;margin:6px auto 0;width:80%;background:#fbf4e8;border-radius:2px;transform:rotate(-4deg)}
body.home main{position:relative;z-index:2;margin-top:-46px}
.card{background:var(--sheet);border-radius:22px;padding:20px 18px;box-shadow:0 12px 32px rgba(40,24,10,.14);border:1px solid var(--line)}
.card .hd{display:flex;flex-direction:column-reverse;align-items:flex-start;gap:6px}
.card h2{margin:0;font:700 24px/1.1 var(--slab)}
.eyebrow{font:600 10px/1.3 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--rust)}
.card label{display:block;font-weight:600;margin:18px 0 8px}
.count{text-align:right;font-size:12px;color:var(--muted);margin-top:4px}
.ideas-t{font-size:13px;color:var(--muted);margin:6px 0 0}
.card .chips{margin:10px -18px 0;padding:0 18px 4px}
.card .chip{display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:16px;background:var(--paper);text-align:left;max-width:200px;line-height:1.2;font-size:13px}
.chip svg{flex:none;color:var(--ink)}
.card details{margin-top:16px}
.card summary{list-style:none;color:var(--ink);font-weight:600;font-size:15px;display:flex;gap:10px;align-items:center}
.card summary::-webkit-details-marker{display:none}
.card summary::before{content:"\203A";font-size:24px;line-height:1;color:var(--rust);transition:transform .2s}
.card details[open] summary::before{transform:rotate(90deg)}
.card .hint{font-size:13px;color:var(--muted);margin:2px 0 0 20px}
.btn.send{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:18px;border-radius:14px;padding:16px;font-size:17px;box-shadow:0 8px 18px rgba(184,71,28,.28)}
.rhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:30px 0 12px}
.rhead h2{margin:0;font:700 26px/1 var(--slab)}
.filters{display:flex;background:var(--sheet);border:1px solid var(--line);border-radius:999px;padding:3px;overflow-x:auto;scrollbar-width:none;min-width:0}
.filters::-webkit-scrollbar{display:none}
.filters button{border:0;background:transparent;color:var(--muted);font:600 13px var(--sans);padding:8px 11px;border-radius:999px;white-space:nowrap;cursor:pointer}
.filters button.on{background:var(--green);color:#fff}
a.rq{display:flex;gap:14px;align-items:center;background:var(--sheet);border:1px solid var(--line);border-radius:18px;padding:14px;margin:10px 0;text-decoration:none;color:inherit}
.sbox{flex:none;width:58px;height:58px;border-radius:14px;background:var(--paper);border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center}
.sbox b{font:700 17px/1 var(--sans)}
.sbox small{font:600 9px/1 var(--sans);color:var(--muted);margin-top:5px;letter-spacing:.08em;text-transform:uppercase}
.rq .body{min-width:0;flex:1}
.rq .ask{font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rq .meta{flex-wrap:wrap}
.st.live{background:var(--green)}
.tabs a{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 0 9px;font-size:12px}
.tabs a.on{color:var(--rust)}
.tabs a.on::before{left:36%;right:36%;height:4px}
.decide{bottom:calc(64px + env(safe-area-inset-bottom))}
.menu a{display:block;padding:15px 0;border-bottom:1px solid var(--line);font-weight:600;text-decoration:none;color:var(--ink)}
@media (prefers-reduced-motion:no-preference){.steam path{animation:steam 3.2s ease-in-out infinite}.steam path:nth-child(2){animation-delay:1.1s}}
@keyframes steam{0%{opacity:0;transform:translateY(8px)}40%{opacity:.75}100%{opacity:0;transform:translateY(-12px)}}
@media (min-width:560px){.hero h1{font-size:48px}.hero p{font-size:18px}}
.mode{margin-top:16px}.mode .hint{margin:8px 2px 0;font-size:13px;color:var(--muted)}
.cost{margin-top:10px;font:500 13px/1.5 var(--mono);color:var(--muted)}.cost b{color:var(--ink)}
</style></head>
<body>
<header class="hero"><div class="bar"><button class="round" id="mbtn" aria-label="Menu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><a class="logo" href="#/"><svg width="52" height="24" viewBox="0 0 64 28" aria-hidden="true"><path d="M18 19c2-9 6-16 14-16s12 7 14 16c8 0 14 2 16 5-10 5-50 5-60 0 2-3 8-5 16-5z" fill="#c0562a"/><path d="M24 10c3 2 13 2 16 0" stroke="#8a3a18" stroke-width="2" fill="none" stroke-linecap="round"/></svg><b>Rodeo</b><small>Build together</small></a><button class="round" id="pbtn" aria-label="Owner sign in"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg></button></div><div class="copy"><h1>Great coffee is a team effort.</h1><p>Share ideas. Help us make Barn Coffee even better.</p><div class="script">Better<br>Coffee<br>Together</div><svg class="art" viewBox="0 0 240 190" aria-hidden="true"><defs><linearGradient id="mg" x1="0" x2="1"><stop offset="0" stop-color="#f1e5d3"/><stop offset=".6" stop-color="#e2cfb3"/><stop offset="1" stop-color="#b99e7c"/></linearGradient></defs><g class="steam" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"><path d="M98 58c-10-14 10-22 0-38"/><path d="M130 56c-10-14 10-22 0-38"/></g><ellipse cx="118" cy="184" rx="100" ry="8" fill="#000" opacity=".35"/><path d="M188 98c32 0 36 52 0 56" fill="none" stroke="#c8b092" stroke-width="13"/><path d="M40 74h150l-8 94c-1 10-9 16-19 16H67c-10 0-18-6-19-16z" fill="url(#mg)"/><ellipse cx="115" cy="74" rx="75" ry="11" fill="#2e180b"/><ellipse cx="115" cy="73" rx="75" ry="10" fill="none" stroke="#f5ecdf" stroke-width="4"/><path d="M88 140c4-15 9-23 27-23s23 8 27 23c8 0 14 2 16 5-12 5-74 5-86 0 2-3 8-5 16-5z" fill="#5a2e17"/></svg></div></header>
<main id="view"></main>
<div class="decide" id="decide" hidden></div>
<nav class="tabs"><a href="#/" data-t="arena"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>Arena</a><a href="#/ledger" data-t="ledger"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>Ledger</a><a href="#/how" data-t="how"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 6v14"/></svg>How it works</a></nav>
<div class="pin" id="menu"><div class="box menu"><h3 style="margin-top:0">Rodeo</h3><a href="/p/barn-coffee/main/index.html" target="_blank" rel="noopener">View the live Barn Coffee site</a><a href="#/ledger" data-close>Ledger: every change and its request</a><a href="#/how" data-close>How it works</a><a href="#" id="mreset">Reset the demo site</a><button class="btn ghost" id="mx">Close</button></div></div>
<div class="pin" id="owner"><div class="box"><h3 style="margin-top:0">Owner</h3><p class="muted" id="otext" style="font-size:14px"></p><button class="btn" id="oin">Enter the owner PIN</button><button class="btn ghost" id="ox">Close</button></div></div>
<div class="pin" id="pin"><div class="box"><h3 style="margin-top:0">Owner PIN</h3><p class="muted" style="font-size:14px">Sending requests and saying yes takes the owner PIN. The demo PIN is in the README.</p><input id="pinin" type="password" inputmode="text" autocomplete="off" placeholder="PIN"><button class="btn" id="pinok">Continue</button><button class="btn ghost" id="pinx">Cancel</button></div></div>
<script>
var V=document.getElementById('view'),D=document.getElementById('decide');
var S={r:'',id:0,data:null,sel:0,mode:'after',src:''};
var LABEL={queued:'In line',drafting:'Writing checks',racing:'Riders racing',awaiting_owner:'Your call',merging:'Merging',replaying:'Replaying',merged:'Live',rejected:'Turned down',undoing:'Undoing',undone:'Undone',no_winner:'No winner',replay_failed:'Replay failed',error:'Error'};
var CLS={merged:'live',awaiting_owner:'call',queued:'run',drafting:'run',racing:'run',merging:'run',replaying:'run',undoing:'run',no_winner:'bad',replay_failed:'bad',error:'bad'};
var STAGE={waiting:0,fork:1,build:2,push:3,judge:4,done:5,out:5};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ago(t){var s=Math.round((Date.now()-t)/1000);if(s<60)return s+'s ago';if(s<3600)return Math.round(s/60)+'m ago';if(s<86400)return Math.round(s/3600)+'h ago';return Math.round(s/86400)+'d ago'}
function clock(t){var d=new Date(t);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)+':'+('0'+d.getSeconds()).slice(-2)}
function api(path,body){
  var o={headers:{'content-type':'application/json'}};
  if(body!==undefined){o.method='POST';o.body=JSON.stringify(body);o.headers['x-rodeo-pin']=localStorage.getItem('rodeo_pin')||''}
  return fetch(path,o).then(function(r){return r.json().then(function(j){if(r.status===401){return askPin().then(function(){return api(path,body)})}if(!r.ok)throw new Error(j.error||('Error '+r.status));return j})});
}
function askPin(){return new Promise(function(ok,no){var p=document.getElementById('pin'),i=document.getElementById('pinin');p.classList.add('on');i.value='';setTimeout(function(){i.focus()},50);
  document.getElementById('pinok').onclick=function(){localStorage.setItem('rodeo_pin',i.value.trim());p.classList.remove('on');ok()};
  document.getElementById('pinx').onclick=function(){p.classList.remove('on');no(new Error('PIN needed'))}})}
function tabs(t){var a=document.querySelectorAll('.tabs a');for(var i=0;i<a.length;i++)a[i].classList.toggle('on',a[i].getAttribute('data-t')===t)}
function st(s){return '<span class="st '+(CLS[s]||'')+'">'+esc(LABEL[s]||s)+'</span>'}
function decide(html){if(!html){D.hidden=true;D.innerHTML='';document.body.classList.remove('decide-on');return}D.hidden=false;D.innerHTML='<div class="inner">'+html+'</div>';document.body.classList.add('decide-on')}

/* Arena v2 */
var ICON={cup:'<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2"/>',leaf:'<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15z"/><path d="M5 19l9-9"/>',clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',tag:'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',phone:'<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z"/>',plane:'<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'};
function ico(n,s){s=s||22;return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICON[n]+'</svg>'}
var CHIPS=[{l:'Add a Mocha for $5.25',a:'Add a Mocha for $5.25 with the note "Chocolate and espresso"',i:'cup'},{l:'Make the header dark green',a:'Make the header dark green with cream text',i:'leaf'},{l:'Open Sundays 9am to 1pm',a:'Open Sundays 9am to 1pm',i:'clock'},{l:'Put the cinnamon roll on sale',a:'Put the cinnamon roll on sale for $2.95',i:'tag'},{l:'Add our phone number',a:'Add our phone number (555) 214-7788 to the footer',i:'phone'}];
var FILTERS=[['all','All'],['run','Racing'],['call','Your call'],['live','Live']];
var MHINT={smart:'One rider first. The others only ride if it misses a check. Fewest tokens.',full:'All three riders at once. About three times the tokens. Best for bigger changes.'};
S.race='smart';
function ktok(n){return n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':String(n)}
function costLine(it,lanes){var t=(it.tokens_in||0)+(it.tokens_out||0),mode=it.mode==='full'?'Full race':'Smart race';var done=['racing','queued','drafting'].indexOf(it.status)<0;var rested=it.mode!=='full'&&done&&lanes.length===1?' · 2 riders stayed in the barn':'';if(!t)return '<div class="cost">'+mode+rested+'</div>';return '<div class="cost"><b>'+t.toLocaleString()+'</b> tokens · '+(it.ai_calls||0)+' AI calls · '+mode+rested+'</div>'}
S.filter='all';
function showArena(){
  tabs('arena');decide('');S.r='arena';
  V.innerHTML='<section class="card"><div class="hd"><h2>Submit a request</h2><span class="eyebrow">The request is the commit.</span></div>'+
  '<label for="ask">What should change on Barn Coffee?</label><textarea id="ask" maxlength="500" placeholder="Write it like you would text your web person..."></textarea><div class="count" id="cnt">0/500</div>'+
  '<div class="ideas-t">Popular ideas</div><div class="chips">'+CHIPS.map(function(c,i){return '<button class="chip" data-i="'+i+'">'+ico(c.i)+'<span>'+esc(c.l)+'</span></button>'}).join('')+'</div>'+
  '<details><summary>Add your own checks (optional)</summary><div class="hint">One per line. Leave it empty and Rodeo writes them for you.</div><textarea id="checks" placeholder="The Mocha shows $5.25 on the menu"></textarea></details>'+
  '<div class="mode"><div class="seg" id="mode"><button data-m="smart" class="'+(S.race==='smart'?'on':'')+'">Smart race</button><button data-m="full" class="'+(S.race==='full'?'on':'')+'">Full race</button></div><div class="hint" id="mhint">'+MHINT[S.race]+'</div></div>'+
  '<button class="btn send" id="go">'+ico('plane',20)+'<span>Send to the riders</span></button><div class="err" id="err"></div></section>'+
  '<div class="rhead"><h2>Requests</h2><div class="filters" id="flt">'+FILTERS.map(function(f){return '<button data-f="'+f[0]+'" class="'+(S.filter===f[0]?'on':'')+'">'+f[1]+'</button>'}).join('')+'</div></div><div id="list"><div class="empty">Loading...</div></div>';
  var ask=document.getElementById('ask'),cnt=document.getElementById('cnt');
  function count(){cnt.textContent=ask.value.length+'/500'}
  ask.oninput=count;
  var cs=V.querySelectorAll('.chip');for(var i=0;i<cs.length;i++)cs[i].onclick=function(){ask.value=CHIPS[+this.getAttribute('data-i')].a;count();ask.focus()};
  var mb=V.querySelectorAll('#mode button');for(var q=0;q<mb.length;q++)mb[q].onclick=function(){S.race=this.getAttribute('data-m');for(var x=0;x<mb.length;x++)mb[x].classList.toggle('on',mb[x]===this);document.getElementById('mhint').textContent=MHINT[S.race]};
  var fb=V.querySelectorAll('#flt button');for(var k=0;k<fb.length;k++)fb[k].onclick=function(){S.filter=this.getAttribute('data-f');for(var x=0;x<fb.length;x++)fb[x].classList.toggle('on',fb[x]===this);renderList()};
  document.getElementById('go').onclick=function(){
    var b=this,a=ask.value.trim(),ch=document.getElementById('checks').value.split('\n').map(function(s){return s.trim()}).filter(Boolean),er=document.getElementById('err');
    er.textContent='';if(a.length<4){er.textContent='Write what should change first.';return}
    b.disabled=true;
    api('/api/intents',{ask:a,checks:ch,mode:S.race||'smart'}).then(function(j){location.hash='#/i/'+j.id}).catch(function(e){er.textContent=e.message;b.disabled=false});
  };
  refreshArena();
}
function refreshArena(){return api('/api/state').then(function(j){S.state=j;renderList()}).catch(function(){})}
function renderList(){
  var L=document.getElementById('list');if(!L||!S.state)return;
  var f=S.filter,items=S.state.intents.filter(function(it){if(f==='live')return it.status==='merged';if(f==='call')return it.status==='awaiting_owner';if(f==='run')return CLS[it.status]==='run';return true});
  if(!items.length){L.innerHTML='<div class="empty">'+(f==='all'?'No requests yet. Send the first one above, or tap an idea.':'Nothing here right now.')+'</div>';return}
  L.innerHTML=items.map(function(it){
    var best=null;it.lanes.forEach(function(l){if(l.stage==='done'&&(!best||l.passed>best.passed))best=l});
    var box=best?'<b>'+best.passed+'/'+best.total+'</b><small>checks</small>':(CLS[it.status]==='run'?'<b>&middot;&middot;&middot;</b><small>racing</small>':'<b>&ndash;</b><small>checks</small>');
    var pips=it.lanes.sort(function(a,b){return a.slot-b.slot}).map(function(l){return '<i class="'+(l.stage==='done'?'d'+l.slot:l.stage==='out'?'x':'')+'"></i>'}).join('');
    return '<a class="rq" href="#/i/'+it.id+'"><div class="sbox">'+box+'</div><div class="body"><div class="ask">'+esc(it.ask)+'</div><div class="meta"><span class="num">#'+it.id+'</span>'+st(it.status)+(it.replayed?'<span class="tag rp">Replayed</span>':'')+'<span>'+ago(it.created_at)+'</span>'+((it.tokens_in||0)+(it.tokens_out||0)>0?'<span class="num">'+ktok(it.tokens_in+it.tokens_out)+' tokens</span>':'')+'<span class="pips">'+pips+'</span></div></div></a>';
  }).join('');
}

/* Intent */
function showIntent(id){
  tabs('arena');S.r='intent';S.id=id;S.sel=0;S.mode='after';S.src='';
  V.innerHTML='<a class="back" href="#/">&larr; All requests</a><div id="ih"></div><h2>The race</h2><div id="lanes"></div>'+
  '<h2>Preview</h2><div class="seg"><button data-m="before">Before</button><button data-m="after">After</button></div><div class="frame"><iframe id="pv" sandbox="allow-scripts" title="Site preview"></iframe></div><div class="cap" id="cap"></div>'+
  '<h2>Checks</h2><div id="ck"></div><h2>What happened</h2><div class="log" id="log"></div><h2>Git</h2><div class="git" id="git"></div>';
  var b=V.querySelectorAll('.seg button');for(var i=0;i<b.length;i++)b[i].onclick=function(){S.mode=this.getAttribute('data-m');paint()};
  refreshIntent();
}
function refreshIntent(){
  return api('/api/intents/'+S.id).then(function(j){if(S.r!=='intent'||j.intent.id!==S.id)return;S.data=j;paint()}).catch(function(e){V.innerHTML='<a class="back" href="#/">&larr; All requests</a><div class="empty">'+esc(e.message)+'</div>'});
}
function laneFor(j){var sel=null;j.lanes.forEach(function(l){if(l.id===S.sel)sel=l});if(sel)return sel;var w=null;j.lanes.forEach(function(l){if(l.id===j.intent.winner_lane)w=l});if(w)return w;var best=null;j.lanes.forEach(function(l){if(l.commit_hash&&(!best||(l.score||0)>(best.score||0)))best=l});return best}
function paint(){
  var j=S.data;if(!j)return;var it=j.intent,lane=laneFor(j);
  var line={queued:'Waiting for a free rider.',drafting:'Turning your words into checks.',racing:'Three riders are building it on their own forks.',awaiting_owner:'The judge picked a winner. Your call.',merging:'Merging the winner into main.',replaying:'Main moved. Rebuilding your request on the new code.',merged:'Live on the site.',rejected:'You turned it down. Nothing changed.',undoing:'Putting it back.',undone:'Undone. The site is back how it was.',no_winner:'No rider passed enough checks. Nothing changed.',replay_failed:'Could not rebuild on the new code. Nothing changed.',error:'Something broke. Nothing changed on the live site.'}[it.status]||'';
  document.getElementById('ih').innerHTML='<div class="quote">&ldquo;'+esc(it.ask)+'&rdquo;</div><div class="statusline">'+st(it.status)+(it.replayed?'<span class="tag rp">Replayed</span>':'')+'<span>'+esc(line)+'</span></div>'+costLine(it,j.lanes);
  var moving=['racing','drafting','queued'].indexOf(it.status)>=0;
  document.getElementById('lanes').innerHTML=j.lanes.length?j.lanes.map(function(l){
    var s=STAGE[l.stage]||0,pct=Math.min(100,s*20),win=l.id===it.winner_lane;
    var sc=l.stage==='done'?(l.passed+'/'+l.total):l.stage==='out'?'out':'';
    var note=l.stage==='out'?(l.error||'Fell off'):(l.note||({waiting:'Saddling up',fork:'Forking the repo',build:'Building the change',push:'Pushing to its fork',judge:'With the judge'}[l.stage]||''));
    if(l.stage==='done')note=(l.lines_changed||0)+' lines changed'+(l.tokens?' · '+ktok(l.tokens)+' tokens':'')+(l.note?' · '+l.note:'');
    return '<div class="lane l'+l.slot+(l.stage==='out'?' out':'')+(lane&&lane.id===l.id?' sel':'')+(moving&&l.stage!=='done'&&l.stage!=='out'?' moving':'')+'" data-id="'+l.id+'"><div class="lhead"><span class="dot"></span><b>'+esc(l.rider)+'</b>'+(win?'<span class="ribbon">Winner</span>':'')+'<span class="score">'+sc+'</span></div>'+
    '<div class="track"><div class="rail"></div><div class="fill" style="width:calc(('+pct+'% ) * 0.94)"></div><div class="finish"></div><div class="puck" style="left:calc(11px + ('+pct+'% - 22px) * 0.94)">'+l.slot+'</div></div>'+
    '<div class="stops"><span>Fork</span><span>Build</span><span>Push</span><span>Judge</span></div><div class="lnote">'+esc(note)+'</div></div>';
  }).join(''):'<div class="empty">Riders start as soon as the checks are written.</div>';
  var ls=document.querySelectorAll('.lane');for(var i=0;i<ls.length;i++)ls[i].onclick=function(){S.sel=+this.getAttribute('data-id');S.mode='after';paint()};
  var sb=V.querySelectorAll('.seg button');for(var k=0;k<sb.length;k++)sb[k].classList.toggle('on',sb[k].getAttribute('data-m')===S.mode);
  var src='',cap='';
  if(S.mode==='before'){var ref=it.merged_parent||it.base_commit;if(ref){src='/p/barn-coffee/'+ref+'/index.html';cap='main at '+ref.slice(0,7)}}
  else if(it.status==='merged'||it.status==='undoing'||it.status==='undone'){if(it.merged_commit){src='/p/barn-coffee/'+it.merged_commit+'/index.html';cap='merged '+it.merged_commit.slice(0,7)}}
  else if(lane&&lane.commit_hash){src='/p/'+lane.fork+'/'+encodeURIComponent('rodeo/i'+it.id)+'/index.html';cap=lane.rider+' fork at '+lane.commit_hash.slice(0,7)}
  var pv=document.getElementById('pv');
  if(src!==S.src){S.src=src;pv.src=src||'about:blank'}
  document.getElementById('cap').innerHTML='<span>'+esc(cap||(S.mode==='before'?'Waiting for the starting line':'Nothing to show yet'))+'</span>'+(src?'<a href="'+src+'" target="_blank" rel="noopener">Open</a>':'');
  var res=lane&&lane.results&&lane.results.results;
  document.getElementById('ck').innerHTML=it.checks.length?'<ul class="checks">'+it.checks.map(function(c,i){var r=res&&res[i];return '<li><span class="mark '+(r?(r.pass?'p':'f'):'')+'">'+(r?(r.pass?'&#10003;':'&#10005;'):(i+1))+'</span><span>'+esc(c)+(r&&r.why?'<span class="why">'+esc(r.why)+'</span>':'')+'</span></li>'}).join('')+'</ul>'+(lane&&lane.results?'<p class="muted" style="font-size:13px">Scored by '+esc(lane.results.by||j.judge)+' for '+esc(lane.rider)+'.'+(lane.results.extra?' Flagged: '+esc(lane.results.extra):'')+'</p>':''):'<div class="empty">Checks appear here in a moment.</div>';
  document.getElementById('log').innerHTML=j.events.map(function(e){return '<div><time>'+clock(e.at)+'</time>'+esc(e.text)+'</div>'}).join('');
  var g=[];if(it.base_commit)g.push('starting line '+it.base_commit);j.lanes.forEach(function(l){if(l.commit_hash)g.push(l.fork+' @ '+l.commit_hash.slice(0,12))});if(it.merged_commit)g.push('main @ '+it.merged_commit);g.push('record .rodeo/intents/'+it.id+'.md');
  document.getElementById('git').innerHTML=g.map(esc).join('<br>');
  if(it.status==='awaiting_owner'){var w=null;j.lanes.forEach(function(l){if(l.id===it.winner_lane)w=l});
    decide('<div class="q">'+esc(w?w.rider+' passed '+w.passed+' of '+w.total+' checks.':'')+' Ship it to the live site?</div><div class="row"><button class="btn ghost" id="dno">No</button><button class="btn" id="dyes">Yes, ship it</button></div>');
    document.getElementById('dyes').onclick=function(){act('yes',this)};document.getElementById('dno').onclick=function(){act('no',this)};
  } else if(it.status==='merged'){
    decide('<div class="row"><button class="btn ghost" style="flex:1" id="dundo">Undo this change</button></div>');document.getElementById('dundo').onclick=function(){act('undo',this)};
  } else if(it.status==='no_winner'||it.status==='replay_failed'){
    decide('<div class="row"><button class="btn ghost" id="dno">Close it</button><button class="btn" id="dagain">Try a full race</button></div>');
    document.getElementById('dno').onclick=function(){act('no',this)};
    document.getElementById('dagain').onclick=function(){var b=this;b.disabled=true;api('/api/intents',{ask:it.ask,checks:it.checks,mode:'full'}).then(function(r){location.hash='#/i/'+r.id}).catch(function(e){b.disabled=false;alert(e.message)})};
  } else decide('');
}
function act(a,b){b.disabled=true;api('/api/intents/'+S.id+'/'+a,{}).then(refreshIntent).catch(function(e){b.disabled=false;alert(e.message)})}

/* Ledger */
function showLedger(){
  tabs('ledger');decide('');S.r='ledger';
  V.innerHTML='<h2>Main branch</h2><p class="muted" style="font-size:14px">Every commit on main is a request someone made. Tap one to see the race behind it.</p><div id="lg"><div class="empty">Loading...</div></div>';
  api('/api/ledger').then(function(j){
    document.getElementById('lg').innerHTML=j.commits.map(function(c){
      var m=c.message.match(/Rodeo-Intent: (\d+)/),undo=/Rodeo-Action: undo/.test(c.message),rp=/Rodeo-Replayed: yes/.test(c.message),title=c.message.split('\n')[0];
      var inner='<div class="t">'+esc(title)+'</div><div class="meta"><span class="num">'+c.hash.slice(0,7)+'</span>'+(m?'<span class="num">#'+m[1]+'</span>':'')+(undo?'<span class="tag ud">Undo</span>':'')+(rp?'<span class="tag rp">Replayed</span>':'')+'<span>'+ago(c.at)+'</span></div>';
      return m?'<a class="req commit" href="#/i/'+m[1]+'">'+inner+'</a>':'<div class="commit">'+inner+'</div>';
    }).join('')||'<div class="empty">No commits yet.</div>';
  }).catch(function(e){document.getElementById('lg').innerHTML='<div class="empty">'+esc(e.message)+'</div>'});
}

/* How */
function showHow(){
  tabs('how');decide('');S.r='how';
  V.innerHTML='<div class="how"><h2>The request is the commit</h2><p>Most Git platforms for agents start from code: branches, diffs, pull requests. Rodeo starts from what the owner actually asked for, because that is the one thing that does not go stale.</p>'+
  '<ol><li><b>A request comes in</b> in plain English. Rodeo turns it into checks anyone could verify by looking at the site.</li>'+
  '<li><b>Riders race.</b> Three different models each get their own Artifacts fork and build the change at the same time.</li>'+
  '<li><b>A judge scores every fork</b> against the checks, plus safety gates (valid JSON, nothing cut off, menu still loads). Ties go to the rider that changed the fewest lines.</li>'+
  '<li><b>The owner reviews the result, not the code.</b> Before and after on their phone. Yes or no.</li>'+
  '<li><b>If main moved underneath, Rodeo replays the request, not the patch.</b> If the new commits touched different files it merges cleanly. If they touched the same file, a rider rebuilds the request on the new code and has to pass the same checks again. Merge conflicts become a re-run.</li></ol>'+
  '<h3>Why it matters</h3><p><b>Why was this changed?</b> The commit message is the request, and the full race is saved in <span class="num">.rodeo/intents/</span> inside the repo, next to the code it produced. Any Git client can read it.</p>'+
  '<p><b>How do you review thousands of agents?</b> You stop reviewing diffs. You review outcomes against checks the owner agreed to.</p>'+
  '<p><b>What about conflicts?</b> Code is disposable. The request is not. Replay it.</p>'+
  '<h3>The token dial</h3><p>Racing costs tokens, so it is a dial, not a rule. <b>Smart race</b> (the default) sends one rider. If it passes every check, it wins and the other riders never leave the barn. Only when it misses do the other two ride. <b>Full race</b> sends all three at once for bigger changes. Every request shows exactly how many tokens it used.</p>'+
  '<h3>Built on</h3><p>Cloudflare Workers, Artifacts (forks, file reads, commit history), Workers AI (three riders and a separate judge), D1, and Queues. Pushes go over plain Git smart HTTP from inside the Worker with a 100-line packfile writer.</p>'+
  '<h3>Who built it</h3><p>Jacob Malherbe, a Rancher: a builder who could not code before AI. Built with Claude. MIT licensed.</p></div>';
}

function router(){var h=location.hash||'#/',home=(h==='#/'||h==='#');document.body.classList.toggle('home',home);var m=h.match(/^#\/i\/(\d+)/);if(m)return showIntent(+m[1]);if(h.indexOf('#/ledger')===0)return showLedger();if(h.indexOf('#/how')===0)return showHow();showArena()}
window.addEventListener('hashchange',function(){router();window.scrollTo(0,0)});
setInterval(function(){if(document.hidden)return;if(S.r==='arena')refreshArena();else if(S.r==='intent'&&S.data&&['merged','rejected','undone','no_winner','replay_failed','error'].indexOf(S.data.intent.status)<0)refreshIntent()},2000);
(function(){
  var M=document.getElementById('menu'),O=document.getElementById('owner');
  document.getElementById('mbtn').onclick=function(){M.classList.add('on')};
  document.getElementById('mx').onclick=function(){M.classList.remove('on')};
  var cl=M.querySelectorAll('[data-close]');for(var i=0;i<cl.length;i++)cl[i].onclick=function(){M.classList.remove('on')};
  document.getElementById('mreset').onclick=function(e){e.preventDefault();M.classList.remove('on');api('/api/reset',{}).then(function(){alert('Barn Coffee is back to the starting site. Request history is kept.')}).catch(function(x){alert(x.message)})};
  function paintOwner(){var on=!!localStorage.getItem('rodeo_pin');document.getElementById('otext').textContent=on?'You are in owner mode on this phone. You can send requests and say yes.':'Owner mode lets you send requests and ship changes. The demo PIN is in the README.';document.getElementById('oin').textContent=on?'Sign out':'Enter the owner PIN'}
  document.getElementById('pbtn').onclick=function(){paintOwner();O.classList.add('on')};
  document.getElementById('ox').onclick=function(){O.classList.remove('on')};
  document.getElementById('oin').onclick=function(){if(localStorage.getItem('rodeo_pin')){localStorage.removeItem('rodeo_pin');paintOwner()}else{O.classList.remove('on');askPin().catch(function(){})}};
})();
router();
</script>
</body></html>`;
