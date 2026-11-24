/* ===== Configuração (vem do index.html: CONFIG e TEXTOS) ===== */
const T = TEXTOS;
const fmt = (t, o) => t.replace(/\{(\w+)\}/g, (m, k) => o[k] != null ? o[k] : m);
const FEE = CONFIG.taxaAgendamento, DISC = CONFIG.descontoCombo;
const CFG = {open: CONFIG.horaAbre, close: CONFIG.horaFecha, days: CONFIG.diasParaAgendar, max: CONFIG.maxBarbeiros,
  services: CONFIG.servicos.map(x => ({id: x.id, n: x.nome, p: x.preco, m: x.minutos, g: x.corte ? "c" : undefined}))};
const N = (CFG.close - CFG.open) * 2, WD = ["dom","seg","ter","qua","qui","sex","sáb"];
const JP = CONFIG.jornadaPadrao; /* jornada padrão até o barbeiro configurar a dele (posições de 30 min desde a abertura) */
const DEF = {d: Array.from({length: 7}, (_, i) => ({on: JP.dias.includes(i), s: (JP.abre - CFG.open) * 2, e: (JP.fecha - CFG.open) * 2}))};

/* ===== Armazenamento (localStorage + sincronização com Supabase) ===== */
const SUPABASE_URL = "https://yqbpyhbmivwrhggfyisx.supabase.co";
const SUPABASE_KEY = "sb_publishable_7MUH5NKYmzivMzzLzAw0MQ_563rjdWn";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ST = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let users = ST.get("users", []), bk = ST.get("bk", []), bl = ST.get("bl", []), mine = ST.get("mine", []), conf = ST.get("conf", {}), meId = ST.get("sess", null);

async function syncCloud() {
  const payload = { users, bk, bl, conf };
  const { error } = await sb.from("barbearia_state").upsert({ id: "main", data: payload, updated_at: new Date().toISOString() });
  if (error) console.error("Erro ao sincronizar com o Supabase:", error);
}

const save = () => {
  ST.set("users", users); ST.set("bk", bk); ST.set("bl", bl); ST.set("mine", mine); ST.set("conf", conf); ST.set("sess", meId);
  syncCloud();
};

async function loadCloud() {
  const { data, error } = await sb.from("barbearia_state").select("data").eq("id", "main").single();
  if (error || !data || !data.data) return;
  const d = data.data;
  if (Array.isArray(d.users)) { users = d.users; ST.set("users", users); }
  if (Array.isArray(d.bk)) { bk = d.bk; ST.set("bk", bk); }
  if (Array.isArray(d.bl)) { bl = d.bl; ST.set("bl", bl); }
  if (d.conf && typeof d.conf === "object") { conf = d.conf; ST.set("conf", conf); }
  render();
}

if (!ST.get("mig", false)) { bk.forEach(b => b.slot += 4); ST.set("mig", true); save(); } /* ajuste: agenda agora começa às 07:00 */

/* ===== Estado e utilitários ===== */
let st = {sel: [], bar: null, date: null, slot: null}, view = "client", mode = "in", done = null, err = "", confirmRemoveId = null;
const app = document.getElementById("app"), main = document.querySelector("main"),
  tg = document.getElementById("tg"), sub = document.getElementById("sub"), feeBox = document.getElementById("fee");
const me = () => users.find(u => u.id === meId);
const barbers = () => users.filter(u => u.role === "barber");
const sched = u => { const x = u && u.sched; if (!x) return DEF; return x.d ? x : {d: x.days.map(on => ({on, s: x.s, e: x.e}))}; };
const nameOf = id => (users.find(u => u.id === id) || {name: "(removido)"}).name;
const pad = n => String(n).padStart(2, "0");
const rs = v => "R$ " + v.toFixed(2).replace(".", ",");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const br = s => s.slice(8) + "/" + s.slice(5, 7);
const lab = i => { const m = CFG.open * 60 + i * 30; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); };
const cmp = (a, b) => a.date.localeCompare(b.date) || a.slot - b.slot;
function el(t, c, x) { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
async function hash(s) {
  try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bb:" + s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  catch (e) { let h = 0; for (const c of "bb:" + s) h = (h * 31 + c.charCodeAt(0)) | 0; return "f" + h; }
}

/* ===== Cálculo de preço e horários ===== */
function calc() {
  const it = CFG.services.filter(s => st.sel.includes(s.id));
  const sub = it.reduce((a, s) => a + s.p, 0), mins = it.reduce((a, s) => a + s.m, 0);
  const combo = it.some(s => s.g === "c") && st.sel.includes("bar") && st.sel.includes("sob");
  const disc = combo ? DISC : 0;
  return {it, sub, combo, disc, total: sub - disc + FEE, n: Math.max(1, Math.ceil(mins / 30))};
}
function days() {
  const sc = sched(users.find(u => u.id === st.bar)), r = [];
  for (let k = 0; r.length < CFG.days && k < 60; k++) { const d = new Date(); d.setDate(d.getDate() + k); if (sc.d[d.getDay()].on) r.push({v: iso(d), w: WD[d.getDay()]}); }
  return r;
}
function free(n) {
  const t = new Set(), sc = sched(users.find(u => u.id === st.bar)), dd = sc.d[new Date(st.date + "T12:00:00").getDay()];
  bk.filter(b => b.bar === st.bar && b.date === st.date).forEach(b => { for (let k = 0; k < b.n; k++) t.add(b.slot + k); });
  bl.filter(b => b.bar === st.bar && b.date === st.date).forEach(b => { for (let k = b.s; k < b.e; k++) t.add(k); });
  const now = new Date(), today = st.date === iso(now), cur = now.getHours() * 60 + now.getMinutes(), r = [];
  for (let i = dd.s; i + n <= dd.e; i++) {
    let ok = true; for (let k = 0; k < n; k++) if (t.has(i + k)) ok = false;
    if (today && CFG.open * 60 + i * 30 <= cur) ok = false;
    r.push({i, ok});
  }
  return r;
}

/* ===== Componentes ===== */
function sec(title) { const s = el("section"); s.appendChild(el("h2", null, title)); app.appendChild(s); return s; }
function chip(p, txt, small, sel, fn, dis) {
  const b = el("button", "chip" + (sel ? " sel" : ""), txt); if (small) b.appendChild(el("small", null, small));
  b.disabled = !!dis; b.onclick = fn; p.appendChild(b); return b;
}
function ln(p, a, b, c) { const d = el("div", "ln" + (c ? " " + c : "")); d.appendChild(el("span", null, a)); d.appendChild(el("span", null, b)); p.appendChild(d); }
function summary(p, c) {
  const w = el("div", "sum");
  c.it.forEach(s => ln(w, s.n, rs(s.p)));
  if (c.combo) ln(w, T.linhaDesconto, "− " + rs(c.disc), "d");
  ln(w, T.linhaTaxa, "+ " + rs(FEE), "f");
  ln(w, T.linhaTotal, rs(c.total), "t"); p.appendChild(w);
}
function toggle(v) {
  const i = st.sel.indexOf(v.id);
  if (i >= 0) st.sel.splice(i, 1);
  else { if (v.g) st.sel = st.sel.filter(x => !CFG.services.find(s => s.id === x && s.g === v.g)); st.sel.push(v.id); }
  st.slot = null; render();
}
function removeBooking(id) {
  bk = bk.filter(b => b.id !== id);
  mine = mine.filter(x => x !== id);
  if (confirmRemoveId === id) confirmRemoveId = null;
  save();
  render();
}

/* ===== Cliente ===== */
function myBox() {
  const t = iso(new Date()), l = bk.filter(b => mine.includes(b.id) && b.date >= t).sort(cmp);
  if (!l.length) return;
  const s = sec(T.seuAgendamento);
  l.forEach(b => {
    const r = el("div", "bk"), d = el("div");
    d.appendChild(el("strong", null, br(b.date) + " às " + lab(b.slot) + " com " + nameOf(b.bar)));
    d.appendChild(el("small", null, b.svc + " · " + rs(b.total)));
    const x = el("button", "link", T.btnCancelar); x.onclick = () => removeBooking(b.id);
    r.appendChild(d); r.appendChild(x); s.appendChild(r);
  });
}
function renderClient() {
  if (done) {
    const s = el("section", "done"); s.appendChild(el("h3", null, T.confirmadoTitulo));
    s.appendChild(el("p", "msg", fmt(T.confirmadoMsg, {nome: done.name, barbeiro: nameOf(done.bar), data: br(done.date), hora: lab(done.slot)})));
    s.appendChild(el("p", "msg", fmt(T.confirmadoTotal, {servicos: done.svc, total: rs(done.total)})));
    const b = el("button", "go", T.btnOutro); b.style.marginTop = "12px"; b.onclick = () => { done = null; render(); };
    s.appendChild(b); app.appendChild(s); myBox(); return;
  }
  myBox();
  let s = sec(T.passo1), r = el("div", "row"); s.appendChild(r);
  CFG.services.forEach(v => chip(r, v.n, rs(v.p), st.sel.includes(v.id), () => toggle(v)));
  s.appendChild(el("p", "tip", fmt(T.dicaCombo, {desconto: rs(DISC)})));
  if (!st.sel.length) return;
  const c = calc(); summary(s, c);
  s = sec(T.passo2);
  if (!barbers().length) { s.appendChild(el("p", "msg", T.semBarbeiros)); return; }
  r = el("div", "row"); s.appendChild(r);
  barbers().forEach(u => chip(r, u.name, null, st.bar === u.id, () => { st.bar = u.id; st.date = null; st.slot = null; render(); }));
  if (!st.bar) return;
  s = sec(T.passo3); r = el("div", "row"); s.appendChild(r);
  days().forEach(d => chip(r, br(d.v), d.w, st.date === d.v, () => { st.date = d.v; st.slot = null; render(); }, bl.some(b => b.bar === st.bar && b.date === d.v && b.s <= 0 && b.e >= N)));
  if (!r.children.length) s.appendChild(el("p", "msg", T.semDias));
  if (!st.date) return;
  s = sec(T.passo4); const f = free(c.n);
  if (!f.some(x => x.ok)) { s.appendChild(el("p", "msg", T.semHorarios)); return; }
  r = el("div", "slots"); s.appendChild(r);
  f.forEach(x => chip(r, lab(x.i), null, st.slot === x.i, () => { st.slot = x.i; render(); }, !x.ok));
  if (st.slot === null) return;
  s = sec(T.passo5);
  s.appendChild(el("p", "msg", "Com " + nameOf(st.bar) + ", " + br(st.date) + " às " + lab(st.slot)));
  summary(s, c); s.lastChild.style.marginBottom = "14px";
  const n = field(s, T.placeholderNome); n.autocomplete = "name";
  const p = field(s, T.placeholderTelefone, "tel"); p.inputMode = "tel"; p.autocomplete = "tel";
  if (err) s.appendChild(el("p", "err", err));
  const g = el("button", "go", T.btnConfirmar + " · " + rs(c.total));
  g.onclick = () => {
    const nm = n.value.trim(), ph = p.value.replace(/\D/g, "");
    if (nm.length < 2) { err = T.erroNome; render(); return; }
    if (ph.length < 10 || ph.length > 11) { err = T.erroTelefone; render(); return; }
    if (!free(c.n).find(x => x.i === st.slot && x.ok)) { err = T.erroOcupado; st.slot = null; render(); return; }
    err = "";
    const b = {id: Date.now(), date: st.date, bar: st.bar, slot: st.slot, n: c.n, svc: c.it.map(x => x.n).join(" + "), total: c.total, name: nm, phone: p.value.trim()};
    bk.push(b); mine.push(b.id); save(); done = b; st = {sel: [], bar: null, date: null, slot: null}; render();
  };
  s.appendChild(g);
}

/* ===== Login e cadastro ===== */
function field(p, ph, type) { const i = el("input"); i.placeholder = ph; i.type = type || "text"; p.appendChild(i); return i; }
function renderLogin() {
  const setup = !users.some(u => u.role === "admin");
  const s = sec(setup ? "Primeiro acesso: criar conta da barbearia (admin)" : mode === "in" ? "Entrar" : "Cadastrar barbeiro");
  if (!setup) {
    const r = el("div", "row"); r.style.marginBottom = "12px";
    chip(r, "Entrar", null, mode === "in", () => { mode = "in"; err = ""; render(); });
    chip(r, "Cadastrar barbeiro", null, mode === "reg", () => { mode = "reg"; err = ""; render(); });
    s.appendChild(r);
  }
  const nm = (setup || mode === "reg") ? field(s, setup ? "Nome da barbearia" : "Seu nome") : null;
  const us = field(s, "Usuário"); us.autocomplete = "username";
  const pw = field(s, "Senha (mínimo 6 caracteres)", "password");
  const cd = (!setup && mode === "reg") ? field(s, "Código da barbearia (peça ao admin)") : null;
  if (err) s.appendChild(el("p", "err", err));
  const g = el("button", "go", setup ? "Criar conta" : mode === "in" ? "Entrar" : "Cadastrar");
  g.onclick = async () => {
    const u = us.value.trim().toLowerCase(), p = pw.value, n = nm ? nm.value.trim() : "", h = await hash(p), id = Date.now() + "";
    err = "";
    if (!setup && mode === "in") {
      const f = users.find(x => x.user === u && x.pass === h);
      if (!f) err = "Usuário ou senha incorretos."; else meId = f.id;
    } else if (n.length < 2) err = "Informe o nome.";
    else if (u.length < 3) err = "O usuário precisa de pelo menos 3 caracteres.";
    else if (p.length < 6) err = "A senha precisa de pelo menos 6 caracteres.";
    else if (users.some(x => x.user === u)) err = "Esse usuário já existe.";
    else if (setup) { users.push({id, name: n, user: u, pass: h, role: "admin"}); conf.code = Math.random().toString(36).slice(2, 8).toUpperCase(); meId = id; }
    else if (!conf.code || cd.value.trim().toUpperCase() !== conf.code) err = "Código da barbearia inválido.";
    else if (barbers().length >= CFG.max) err = "Limite de " + CFG.max + " barbeiros atingido.";
    else { users.push({id, name: n, user: u, pass: h, role: "barber"}); meId = id; }
    if (!err) { view = "panel"; draft = null; save(); }
    render();
  };
  s.appendChild(g);
}

/* ===== Painel do barbeiro e do admin ===== */
function copyTxt(t, btn) {
  const ok = () => { btn.textContent = "Copiado ✓"; setTimeout(() => { btn.textContent = "Copiar número"; }, 1500); };
  function fb() { const i = el("input"); i.value = t; document.body.appendChild(i); i.select(); try { document.execCommand("copy"); ok(); } catch (e) {} i.remove(); }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fb); else fb();
}
function bkRow(b) {
  const r = el("div", "bk"), d = el("div");
  d.appendChild(el("strong", null, br(b.date) + " · " + lab(b.slot)));
  d.appendChild(el("small", null, b.name));
  d.appendChild(el("small", "ph", b.phone));
  d.appendChild(el("small", null, b.svc + " · " + rs(b.total)));
  const a = el("div", "act");
  const cp = el("button", "link", "Copiar número"); cp.onclick = () => copyTxt(b.phone, cp);
  const wa = el("a", "link", "WhatsApp"); wa.href = "https://wa.me/55" + b.phone.replace(/\D/g, ""); wa.target = "_blank"; wa.rel = "noopener";
  const isConfirming = confirmRemoveId === b.id;
  const x = el("button", "link" + (isConfirming ? " danger" : ""), isConfirming ? "Confirmar?" : "Remover");
  x.onclick = () => {
    if (!isConfirming) {
      confirmRemoveId = b.id;
      render();
      return;
    }
    removeBooking(b.id);
  };
  a.appendChild(cp); a.appendChild(wa); a.appendChild(x);
  if (isConfirming) {
    const cancel = el("button", "link", "Manter");
    cancel.onclick = () => { confirmRemoveId = null; render(); };
    a.appendChild(cancel);
  }
  r.appendChild(d); r.appendChild(a); return r;
}
function renderPanel() {
  const u = me(); if (!u) { view = "login"; return render(); }
  const t = iso(new Date()), up = bk.filter(b => b.date >= t).sort(cmp);
  const s = sec("Olá, " + u.name + (u.role === "admin" ? " (administrador)" : ""));
  const out = el("button", "link", "Sair"); out.onclick = () => { draft = null; meId = null; save(); view = "client"; render(); };
  if (u.role === "admin") {
    s.appendChild(el("p", "msg", "Código para cadastro de barbeiros: " + conf.code + " · Barbeiros: " + barbers().length + "/" + CFG.max));
    s.lastChild.style.margin = "0 0 12px"; s.appendChild(out);
    if (!barbers().length) { sec("Agenda").appendChild(el("p", "msg", "Nenhum barbeiro cadastrado ainda. Passe o código acima para eles se cadastrarem.")); return; }
    const cols = el("div", "cols");
    barbers().forEach(b => {
      const c = el("section", "col"); c.appendChild(el("h2", null, b.name)); c.appendChild(el("p", "tip", jornada(b)));
      const l = up.filter(x => x.bar === b.id);
      if (!l.length) c.appendChild(el("p", "msg", "Sem agendamentos."));
      l.forEach(x => c.appendChild(bkRow(x)));
      const rm = el("button", "link", "Remover barbeiro"); rm.style.marginTop = "10px";
      rm.onclick = () => {
        if (rm.dataset.ask) { users = users.filter(y => y.id !== b.id); bk = bk.filter(y => y.bar !== b.id); bl = bl.filter(y => y.bar !== b.id); save(); render(); }
        else { rm.dataset.ask = "1"; rm.textContent = "Tem certeza? Apaga a agenda dele"; }
      };
      c.appendChild(rm); cols.appendChild(c);
    });
    app.appendChild(cols);
  } else {
    s.appendChild(out);
    const s2 = sec("Minha agenda"), l = up.filter(x => x.bar === u.id);
    if (!l.length) s2.appendChild(el("p", "msg", "Nenhum agendamento por enquanto."));
    l.forEach(x => s2.appendChild(bkRow(x)));
    jornadaBox(u); blockBox(u);
  }
}

/* ===== Jornada e bloqueios (barbeiro) ===== */
let draft = null, bf = {date: "", s: DEF.d[1].s, e: DEF.d[1].e}, jn = "", bn = "";
function jornada(u) {
  const g = {};
  sched(u).d.forEach((x, i) => { if (x.on) { const h = lab(x.s) + " às " + lab(x.e); (g[h] = g[h] || []).push(WD[i]); } });
  const k = Object.keys(g); return k.length ? k.map(h => g[h].join(", ") + " " + h).join(" · ") : "sem dias de trabalho";
}
function timeSel(p, from, to, val, fn) {
  const s = el("select");
  for (let i = from; i <= to; i++) { const o = el("option", null, lab(i)); o.value = i; s.appendChild(o); }
  s.value = val; s.onchange = () => fn(+s.value); p.appendChild(s);
}
const WF = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
function jornadaBox(u) {
  if (!draft) draft = JSON.parse(JSON.stringify(sched(u)));
  const s = sec("Minha jornada (horário de cada dia)");
  draft.d.forEach((x, i) => {
    const r = el("div", "dr"); s.appendChild(r);
    const c = chip(r, WF[i], null, x.on, () => { x.on = !x.on; render(); }); c.style.minWidth = "110px";
    if (!x.on) { r.appendChild(el("span", "msg", "Fechado")); return; }
    timeSel(r, 0, N - 1, x.s, v => { x.s = v; if (x.e <= v) x.e = v + 1; render(); });
    r.appendChild(el("span", null, "às"));
    timeSel(r, x.s + 1, N, x.e, v => { x.e = v; });
  });
  const f = draft.d.find(x => x.on);
  if (f) {
    const rp = el("button", "link", "Repetir o horário do primeiro dia aberto nos outros"); rp.style.margin = "4px 0 10px";
    rp.onclick = () => { draft.d.forEach(x => { if (x.on) { x.s = f.s; x.e = f.e; } }); render(); }; s.appendChild(rp);
  }
  if (jn) { s.appendChild(el("p", "tip", jn)); jn = ""; }
  const g = el("button", "go", "Salvar jornada");
  g.onclick = () => { u.sched = draft; draft = null; save(); jn = "Jornada salva."; render(); };
  s.appendChild(g);
}
function blockBox(u) {
  const s = sec("Bloquear dia ou horário"), t = iso(new Date());
  const d = el("input"); d.type = "date"; d.min = t; d.value = bf.date; d.onchange = () => { bf.date = d.value; }; s.appendChild(d);
  const tm = el("div", "tm"); s.appendChild(tm);
  tm.appendChild(el("span", null, "De")); timeSel(tm, 0, N - 1, bf.s, v => { bf.s = v; });
  tm.appendChild(el("span", null, "até")); timeSel(tm, 1, N, bf.e, v => { bf.e = v; });
  const add = whole => {
    if (!bf.date) { bn = "Escolha a data."; render(); return; }
    const b = {id: Date.now(), bar: u.id, date: bf.date, s: whole ? 0 : bf.s, e: whole ? N : bf.e};
    if (b.e <= b.s) { bn = "O horário final precisa ser depois do inicial."; render(); return; }
    const hit = bk.filter(x => x.bar === u.id && x.date === b.date && x.slot < b.e && x.slot + x.n > b.s).length;
    bl.push(b); save();
    bn = hit ? "Bloqueado. Atenção: já existem " + hit + " agendamento(s) nesse período; remova-os na sua agenda se precisar." : "Bloqueio criado.";
    render();
  };
  if (bn) { s.appendChild(el("p", "tip", bn)); bn = ""; }
  const g1 = el("button", "go", "Bloquear esse horário"); g1.onclick = () => add(false);
  const g2 = el("button", "go", "Bloquear o dia inteiro"); g2.onclick = () => add(true);
  s.appendChild(g1); s.appendChild(g2);
  const l = bl.filter(b => b.bar === u.id && b.date >= t).sort((a, b) => a.date.localeCompare(b.date) || a.s - b.s);
  if (l.length) {
    const w = el("div"); w.style.marginTop = "12px"; s.appendChild(w);
    l.forEach(b => {
      const r = el("div", "bk"), x = el("div");
      x.appendChild(el("strong", null, br(b.date) + " · " + (b.s <= 0 && b.e >= N ? "dia inteiro" : lab(b.s) + " às " + lab(b.e))));
      const y = el("button", "link", "Remover bloqueio"); y.onclick = () => { bl = bl.filter(z => z.id !== b.id); save(); render(); };
      r.appendChild(x); r.appendChild(y); w.appendChild(r);
    });
  }
}

/* ===== Tela principal ===== */
function render() {
  app.innerHTML = ""; const u = me();
  main.className = view === "panel" && u && u.role === "admin" ? "wide" : "";
  tg.textContent = view === "client" ? (u ? T.btnMeuPainel : T.btnAreaBarbearia) : T.btnVoltar;
  sub.textContent = view === "client" ? T.subtitulo : T.subtituloPainel;
  feeBox.style.display = view === "client" ? "" : "none";
  if (view === "login") return renderLogin();
  if (view === "panel") return renderPanel();
  renderClient();
}
tg.onclick = () => { view = view === "client" ? (me() ? "panel" : "login") : "client"; err = ""; done = null; draft = null; render(); };
document.querySelectorAll("[data-taxa]").forEach(e => { e.textContent = rs(FEE); });
render();
loadCloud();