import './style.css';

const STORAGE_KEY = 'hours-ledger.entries.v1';
const HOURLY_RATE_SHEKELS = 28;
const SHEKELS_PER_DOLLAR = 3.4;
const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const API_URL = configuredApiUrl ? `${configuredApiUrl.startsWith('http') ? '' : 'https://'}${configuredApiUrl}`.replace(/\/$/, '') : '';
const API_TOKEN = import.meta.env.VITE_API_TOKEN || '';
const app = document.querySelector('#app');
const state = { entries: loadEntries(), route: getRoute(), editingId: null };

function loadEntries() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), ...options.headers }
  });
  if (!response.ok) throw new Error(`Cloud storage request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

async function syncEntries() {
  if (!API_URL) return;
  try {
    state.entries = await apiRequest('/api/entries');
    saveEntries();
    render();
  } catch (error) {
    console.error(error);
  }
}

function getRoute() {
  return window.location.hash.slice(1) || '/';
}

function formatHours(value) {
  return `${Number(value || 0).toFixed(2)} h`;
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 }).format(Number(value || 0));
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
}

function totalHours(entries = state.entries) {
  return entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
}

function totalShekels(entries = state.entries) {
  return totalHours(entries) * HOURLY_RATE_SHEKELS;
}

function currentWeekEntries() {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return state.entries.filter((entry) => new Date(`${entry.date}T12:00:00`) >= monday);
}

function updateMeta(title, description) {
  document.title = title;
  document.querySelector('meta[name="description"]').setAttribute('content', description);
  document.querySelector('link[rel="canonical"]').setAttribute('href', `${window.location.origin}${window.location.pathname}${state.route === '/' ? '' : `#${state.route}`}`);
}

function layout(content, active = '/') {
  return `<div class="shell">
    <header class="topbar">
      <a class="brand" href="#/" aria-label="Hours Ledger home"><span class="brand-mark">HL</span><span>hours ledger</span></a>
      <nav class="nav" aria-label="Primary navigation">
        <a class="nav-link ${active === '/' ? 'active' : ''}" href="#/">Overview</a>
        <a class="nav-link ${active === '/log' ? 'active' : ''}" href="#/log">Log hours</a>
      </nav>
      <span class="privacy"><span class="status-dot"></span>Private by design</span>
    </header>
    ${content}
    <footer class="footer"><span>Hours Ledger</span><span>${API_URL ? 'Synced to Cloudflare D1' : 'Stored locally in this browser'}</span></footer>
  </div>`;
}

function renderOverview() {
  updateMeta('Overview | Hours Ledger', 'Review your work hours, weekly pace, and recent shifts in Hours Ledger.');
  const week = currentWeekEntries();
  const sorted = [...state.entries].sort((a, b) => b.date.localeCompare(a.date));
  app.innerHTML = layout(`<main class="page">
    <div class="breadcrumb"><a href="#/">Workspace</a><span>/</span><span>Overview</span></div>
    <section class="hero-row"><div><p class="eyebrow">Your time, made visible</p><h1>Good work deserves a clear record.</h1><p class="lede">Log each shift in seconds. Your hours stay private and available wherever you open this browser.</p></div><a class="button button-primary" href="#/log"><span class="button-icon">+</span> Log a shift</a></section>
    <section class="stats-grid" aria-label="Hours summary">
      <article class="stat-card stat-featured"><span class="stat-label">This week</span><strong>${formatHours(totalHours(week))}</strong><span class="stat-note">${week.length} shift${week.length === 1 ? '' : 's'} logged</span></article>
      <article class="stat-card"><span class="stat-label">All time</span><strong>${formatHours(totalHours())}</strong><span class="stat-note">Across ${state.entries.length} shift${state.entries.length === 1 ? '' : 's'}</span></article>
      <article class="stat-card"><span class="stat-label">Average shift</span><strong>${formatHours(state.entries.length ? totalHours() / state.entries.length : 0)}</strong><span class="stat-note">A simple baseline</span></article>
      <article class="stat-card money-card"><span class="stat-label">Earned</span><strong>${formatMoney(totalShekels(), 'ILS')}</strong><span class="stat-note">At ₪${HOURLY_RATE_SHEKELS} per hour</span></article>
      <article class="stat-card money-card"><span class="stat-label">Earned in dollars</span><strong>${formatMoney(totalShekels() / SHEKELS_PER_DOLLAR, 'USD')}</strong><span class="stat-note">Approx. at ₪${SHEKELS_PER_DOLLAR.toFixed(2)} / $1</span></article>
    </section>
    <section class="content-section"><div class="section-heading"><div><p class="eyebrow">Activity</p><h2>Recent shifts</h2></div><a class="text-link" href="#/log">View log <span>→</span></a></div>${renderEntries(sorted.slice(0, 5), 'Your log is ready when you are.')}</section>
  </main>`);
  bindEntryActions();
}

function renderEntries(entries, emptyMessage) {
  if (!entries.length) return `<div class="empty-state"><div class="empty-icon">∿</div><h3>No shifts logged yet</h3><p>${emptyMessage}</p><a class="button button-secondary" href="#/log">Add your first shift</a></div>`;
  return `<div class="entry-list">${entries.map((entry) => `<article class="entry-row"><div class="entry-date"><span class="date-day">${new Intl.DateTimeFormat('en', { day: '2-digit' }).format(new Date(`${entry.date}T12:00:00`))}</span><span>${new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${entry.date}T12:00:00`))}</span></div><div class="entry-main"><strong>${escapeHtml(entry.project || 'Work shift')}</strong><span>${formatDate(entry.date)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</span></div><strong class="entry-hours">${formatHours(entry.hours)}</strong><div class="entry-actions"><button class="icon-button" data-edit="${entry.id}" aria-label="Edit ${escapeHtml(entry.project || 'work shift')}">Edit</button><button class="icon-button danger" data-delete="${entry.id}" aria-label="Delete ${escapeHtml(entry.project || 'work shift')}">Delete</button></div></article>`).join('')}</div>`;
}

function renderLog() {
  updateMeta('Log hours | Hours Ledger', 'Add, edit, and manage your work shifts privately in Hours Ledger.');
  const editing = state.entries.find((entry) => entry.id === state.editingId);
  app.innerHTML = layout(`<main class="page narrow-page">
    <div class="breadcrumb"><a href="#/">Workspace</a><span>/</span><span>Log hours</span></div>
    <div class="form-intro"><p class="eyebrow">${editing ? 'Update your record' : 'New record'}</p><h1>${editing ? 'Edit this shift.' : 'Log a shift.'}</h1><p class="lede">Keep the details lightweight. You can always come back and refine them later.</p></div>
    <form class="shift-form" id="shift-form"><label>Work date<input type="date" name="date" required value="${editing?.date || new Date().toISOString().slice(0, 10)}"></label><label>Hours worked<input type="number" name="hours" min="0.25" max="24" step="0.25" required placeholder="7.5" value="${editing?.hours || ''}"></label><label>Project or role <span class="optional">Optional</span><input type="text" name="project" maxlength="80" placeholder="e.g. Client support" value="${escapeAttribute(editing?.project || '')}"></label><label>Note <span class="optional">Optional</span><textarea name="note" maxlength="180" rows="3" placeholder="What made this shift distinct?">${escapeHtml(editing?.note || '')}</textarea></label><div class="form-actions"><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Add shift'} <span>→</span></button>${editing ? '<a class="button button-quiet" href="#/log">Cancel</a>' : ''}</div></form>
    <section class="content-section log-section"><div class="section-heading"><div><p class="eyebrow">All activity</p><h2>Your log</h2></div><span class="section-count">${state.entries.length} total</span></div>${renderEntries([...state.entries].sort((a, b) => b.date.localeCompare(a.date)), 'Entries you add will appear here.')}</section>
  </main>`, '/log');
  document.querySelector('#shift-form').addEventListener('submit', handleSubmit);
  bindEntryActions();
}

async function handleSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const entry = { id: state.editingId || crypto.randomUUID(), date: data.date, hours: Number(data.hours), project: data.project.trim(), note: data.note.trim() };
  if (API_URL) await apiRequest(state.editingId ? `/api/entries/${state.editingId}` : '/api/entries', { method: state.editingId ? 'PUT' : 'POST', body: JSON.stringify(entry) });
  if (state.editingId) state.entries = state.entries.map((item) => item.id === state.editingId ? entry : item);
  else state.entries.push(entry);
  state.editingId = null;
  saveEntries();
  window.location.hash = '/log';
  render();
}

function bindEntryActions() {
  document.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => { state.editingId = button.dataset.edit; window.location.hash = '/log'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => { if (window.confirm('Delete this shift from your log?')) { if (API_URL) await apiRequest(`/api/entries/${button.dataset.delete}`, { method: 'DELETE' }); state.entries = state.entries.filter((entry) => entry.id !== button.dataset.delete); saveEntries(); render(); } }));
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function escapeAttribute(value) { return escapeHtml(value); }
function render() { state.route = getRoute(); state.route === '/log' ? renderLog() : renderOverview(); }
window.addEventListener('hashchange', render);
render();
syncEntries();
