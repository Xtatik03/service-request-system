/* Public Service Request System - vanilla JS single-page frontend. */
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app'), nav = $('#nav');
const state = { user: JSON.parse(localStorage.getItem('user') || 'null'), token: localStorage.getItem('token'), meta: null };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (s) => s.replace(' ', '-');
const fmt = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString();

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.body instanceof FormData ? opts.body : opts.body && JSON.stringify(opts.body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) logout();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setSession(data) {
  Object.assign(state, { token: data.token, user: data.user });
  localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user));
  render();
}
function logout() { state.token = state.user = null; localStorage.clear(); render(); }

// ---------- views ----------
function renderNav() {
  nav.innerHTML = state.user
    ? `<span>${esc(state.user.name)} (${state.user.role})</span><button class="ghost" id="logout">Log out</button>` : '';
  $('#logout')?.addEventListener('click', logout);
}

function authView(mode = 'login') {
  const reg = mode === 'register';
  app.innerHTML = `<div class="card auth"><h2>${reg ? 'Create citizen account' : 'Welcome back'}</h2>
    <p class="muted">Report public service issues and track their progress.</p>
    <form id="f">${reg ? '<label>Full name</label><input name="name" required>' : ''}
    <label>Email</label><input name="email" type="email" required>
    <label>Password</label><input name="password" type="password" minlength="6" required>
    <div class="error" id="err"></div><button style="width:100%">${reg ? 'Register' : 'Log in'}</button></form>
    <p class="muted" style="text-align:center">${reg ? 'Have an account?' : 'New here?'}
    <button class="link" id="sw">${reg ? 'Log in' : 'Register'}</button></p>
    ${reg ? '' : '<p class="muted" style="text-align:center">Demo admin: admin@example.com / admin123</p>'}</div>`;
  $('#sw').onclick = () => authView(reg ? 'login' : 'register');
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { setSession(await api(reg ? '/register' : '/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })); }
    catch (err) { $('#err').textContent = err.message; }
  };
}

function requestCard(r, admin) {
  const steps = state.meta.statuses, at = steps.indexOf(r.status);
  return `<div class="req" data-id="${r.id}">
    <div class="req-head"><strong>#${r.id} · ${esc(r.category)}</strong><span class="badge ${cls(r.status)}">${r.status}</span></div>
    <div class="muted">📍 ${esc(r.location)} · ${fmt(r.created_at)}${admin ? ' · by ' + esc(r.citizen) : ''}</div>
    <p>${esc(r.description)}</p>
    ${r.image ? `<a href="${r.image}" target="_blank"><img src="${r.image}" alt="Attached photo"></a>` : ''}
    <div class="track">${steps.map((s, i) => `<div class="${i <= at ? 'on' : ''}">${s}</div>`).join('')}</div>
    ${r.admin_note && !admin ? `<div class="note"><b>Update from the office:</b> ${esc(r.admin_note)}</div>` : ''}
    ${admin ? `<div class="admin-row"><select class="st">${steps.map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input class="nt" placeholder="Note to citizen (optional)" value="${esc(r.admin_note || '')}"><button class="small save">Save</button></div>` : ''}
  </div>`;
}

async function citizenView() {
  app.innerHTML = `<div class="card"><h2>Submit a service request</h2><form id="f">
    <label>Category</label><select name="category">${state.meta.categories.map((c) => `<option>${c}</option>`).join('')}</select>
    <label>Location</label><input name="location" placeholder="e.g. Moi Avenue near Kencom, Nairobi" required>
    <label>Description</label><textarea name="description" required></textarea>
    <label>Photo (optional, max 3MB)</label><input name="image" type="file" accept="image/*">
    <div class="error" id="err"></div><button style="margin-top:8px">Submit request</button></form></div>
    <div class="card"><h2>My requests</h2><div id="list">Loading…</div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); if (!fd.get('image')?.size) fd.delete('image');
    try { await api('/requests', { method: 'POST', body: fd }); e.target.reset(); toast('Request submitted ✔'); load(); }
    catch (err) { $('#err').textContent = err.message; }
  };
  async function load() {
    const rows = await api('/requests');
    $('#list').innerHTML = rows.length ? rows.map((r) => requestCard(r, false)).join('') : '<p class="muted">No requests yet.</p>';
  }
  load();
}

async function adminView() {
  app.innerHTML = `<div id="stats"></div><div class="card"><h2>All requests</h2>
    <div class="filters"><input id="q" placeholder="Search location or description…">
    <select id="fs"><option value="">All statuses</option>${state.meta.statuses.map((s) => `<option>${s}</option>`).join('')}</select>
    <select id="fc"><option value="">All categories</option>${state.meta.categories.map((c) => `<option>${c}</option>`).join('')}</select></div>
    <div id="list">Loading…</div></div>`;
  async function stats() {
    const s = await api('/stats'), max = Math.max(1, ...s.byCategory.map((c) => c.n));
    $('#stats').innerHTML = `<div class="grid">
      <div class="card stat"><b>${s.total}</b><span>Total cases</span></div>
      <div class="card stat"><b style="color:var(--pending)">${s.open}</b><span>Open (${s.byStatus.Pending} pending · ${s.byStatus['In Progress']} in progress)</span></div>
      <div class="card stat"><b style="color:var(--resolved)">${s.resolved}</b><span>Resolved${s.total ? ' · ' + Math.round((s.resolved / s.total) * 100) + '%' : ''}</span></div></div>
      <div class="card"><h3>Cases by category</h3>${s.byCategory.map((c) => `<div class="bar"><span>${esc(c.label)}</span><i style="width:${(c.n / max) * 60}%"></i><span>${c.n}</span></div>`).join('') || '<p class="muted">No data yet.</p>'}</div>`;
  }
  async function list() {
    const p = new URLSearchParams({ q: $('#q').value, status: $('#fs').value, category: $('#fc').value });
    const rows = await api('/requests?' + p);
    $('#list').innerHTML = rows.length ? rows.map((r) => requestCard(r, true)).join('') : '<p class="muted">No matching requests.</p>';
  }
  $('#list').onclick = async (e) => {
    if (!e.target.classList.contains('save')) return;
    const el = e.target.closest('.req');
    try {
      await api('/requests/' + el.dataset.id, { method: 'PATCH', body: { status: $('.st', el).value, admin_note: $('.nt', el).value } });
      toast('Updated ✔'); stats(); list();
    } catch (err) { toast(err.message); }
  };
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(list, 300); };
  $('#fs').onchange = $('#fc').onchange = list;
  stats(); list();
}

async function render() {
  renderNav();
  if (!state.user) return authView();
  state.meta ||= await api('/meta');
  state.user.role === 'admin' ? adminView() : citizenView();
}
render();
