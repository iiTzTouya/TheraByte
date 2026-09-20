/* ================= capability setup ================= */
let DB = null, USERCAP = null, SAMPLE = null, DEMO_MODE = false;
const genId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id_' + Math.random().toString(36).slice(2));

function loadLocalStore() {
  try { return JSON.parse(localStorage.getItem('therabyte_demo_store') || '{}'); }
  catch (e) { return {}; }
}

function saveLocalStore(s) {
  try { localStorage.setItem('therabyte_demo_store', JSON.stringify(s)); }
  catch (e) {}
}

function makeMockDb() {
  let store = loadLocalStore();
  function ensure(path) { if (!store[path]) store[path] = {}; return store[path]; }
  function docRef(path) {
    const parts = path.split('/'); const id = parts.pop(); const coll = parts.join('/');
    return {
      id, path,
      async get() { const c = ensure(coll); return { id, exists: !!c[id], data: () => c[id] }; },
      async set(data) { const c = ensure(coll); c[id] = JSON.parse(JSON.stringify(data)); saveLocalStore(store); },
      async update(data) { const c = ensure(coll); if (!c[id]) throw { code: 'invalid_argument', message: 'missing doc' };
        c[id] = deepMerge(c[id], data); saveLocalStore(store); },
      async delete() { const c = ensure(coll); delete c[id]; saveLocalStore(store); }
    };
  }
  function deepMerge(base, patch) {
    base = base || {};
    for (const k in patch) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = deepMerge(base[k], patch[k]);
      } else {
        base[k] = patch[k];
      }
    }
    return base;
  }
  function collRef(path, filters) {
    filters = filters || [];
    const api = {
      path,
      where(f, op, v) { return collRef(path, filters.concat([[f, op, v]])); },
      _order: null,
      _limit: null,
      orderBy(f, dir) { const q = collRef(path, filters); q._order = [f, dir || 'asc']; q._limit = api._limit; return q; },
      limit(n) { const q = collRef(path, filters); q._limit = n; q._order = api._order; return q; },
      doc(id) { return docRef(path + '/' + (id || genId())); },
      async add(data) { const ref = docRef(path + '/' + genId()); await ref.set(data); return ref; },
      async get() {
        const c = ensure(path);
        let docs = Object.keys(c).map(id => ({ id, exists: true, data: () => c[id] }));
        docs = docs.filter(d => filters.every(([f, op, v]) => {
          const val = d.data()[f];
          if (op === '==') return val === v;
          if (op === '!=') return val !== v;
          if (op === '<') return val < v;
          if (op === '<=') return val <= v;
          if (op === '>') return val > v;
          if (op === '>=') return val >= v;
          return true;
        }));
        if (api._order) {
          const [f, dir] = api._order;
          docs.sort((a, b) => (a.data()[f] > b.data()[f] ? 1 : -1) * (dir === 'desc' ? -1 : 1));
        }
        if (api._limit) docs = docs.slice(0, api._limit);
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
    return api;
  }
  return { doc: docRef, collection: (p) => collRef(p, []) };
}

function makeMockUser() {
  let uid = localStorage.getItem('therabyte_demo_uid');
  if (!uid) {
    uid = 'guest_' + genId().slice(0, 8);
    localStorage.setItem('therabyte_demo_uid', uid);
  }
  return {
    async isOwner() { return false; },
    async canEdit() { return true; },
    async can() { return true; },
    async id() { return uid; },
    async me() { return { id: uid, name: '', avatarUrl: '', color: '#8FA888', email: null, isOwner: false, canEdit: true }; },
    async profiles(ids) {
      const arr = Array.isArray(ids) ? ids : [ids];
      const out = {};
      arr.forEach(i => out[i] = { id: i, name: '', avatarUrl: '', color: '#8FA888', email: null, isMe: i === uid });
      return out;
    }
  };
}

const App = { uid: null, name: '', profile: null, tab: 'dashboard', therapists: [], selectedClient: null, chat: [], busy: false };

async function initCapabilities() {
  try {
    if (window.claude && window.claude.use) {
      DB = await window.claude.use('db');
      USERCAP = await window.claude.use('user');
      SAMPLE = await window.claude.use('sample');
    }
  } catch (e) {}
  if (!DB || !USERCAP) {
    DEMO_MODE = true;
    DB = DB || makeMockDb();
    USERCAP = USERCAP || makeMockUser();
  }
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function mount(html) { document.getElementById('app').innerHTML = html; }

async function boot() {
  mount(shellSkeleton('<div class="wrap"><p class="sub">Loading TheraByte…</p></div>'));
  await initCapabilities();
  const me = await USERCAP.me();
  App.uid = await USERCAP.id() || me.id;
  App.name = me.name || '';
  const snap = await DB.doc('profiles/' + App.uid).get();
  if (snap.exists) { App.profile = snap.data(); }
  render();
}

function logoSvg(size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M32 6C18 6 8 17 9 30c.6 8 5 15 12 19-1 3-3 5-6 7 5 1.5 10 .5 14-2 1 .3 2 .5 3 .5 14 0 24-11 23-24C54 17 44 6 32 6Z" fill="#8FA888" opacity="0.9"/>' +
    '<path d="M32 14c-4 3-6 7-5 12 1 4 4 6 8 6" stroke="#4F6350" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '<circle cx="43" cy="22" r="2.4" fill="#AACAD9"/><path d="M35 22h5M43 24.4v5" stroke="#AACAD9" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';
}

function shellSkeleton(inner) {
  return '<header class="top"><div class="top-row"><div class="brand">' + logoSvg(30) + '<span>TheraByte</span></div></div></header><main>' + inner + '</main>';
}

function render() {
  if (!App.profile) {
    mount(shellSkeleton(onboardingView()));
    return;
  }
  const tabs = App.profile.role === 'therapist'
    ? [['dashboard', 'Dashboard'], ['calendar', 'Calendar'], ['clients', 'Clients'], ['bodymap', 'Body map'], ['tutorials', 'Tutorials'], ['assistant', 'Assistant']]
    : [['dashboard', 'Dashboard'], ['calendar', 'Book a session'], ['bodymap', 'My body map'], ['tutorials', 'Tutorials'], ['assistant', 'Assistant']];

  let tabsHtml = tabs.map(([id, label]) => '<button class="' + (App.tab === id ? 'active' : '') + '" onclick="setTab(\'' + id + '\')">' + label + '</button>').join('');

  let content = '';
  if (App.tab === 'dashboard') content = dashboardView();
  else if (App.tab === 'calendar') content = calendarView();
  else if (App.tab === 'clients') content = clientsView();
  else if (App.tab === 'bodymap') content = bodymapShell();
  else if (App.tab === 'tutorials') content = tutorialsView();
  else if (App.tab === 'assistant') content = assistantView();

  const demoNotice = DEMO_MODE ? '<div class="notice">This is the public demo of TheraByte — everything works, but each visitor\'s accounts, bookings, and body map are saved to their own browser only, not shared with anyone else.</div>' : '';

  mount(
    '<header class="top">' +
      '<div class="top-row">' +
        '<div class="brand">' + logoSvg(30) + '<span>TheraByte</span></div>' +
        '<div class="who"><span class="pill">' + (App.profile.role === 'therapist' ? 'Therapist' : 'Client') + '</span>' + escapeHtml(App.profile.name) +
        ' &nbsp;<a href="#" onclick="editProfile();return false;" style="color:var(--sage-deep);font-weight:600;">Edit</a></div>' +
      '</div>' +
      '<div class="tabs">' + tabsHtml + '</div>' +
    '</header>' +
    '<main>' + demoNotice + content + '</main>'
  );

  if (App.tab === 'bodymap') afterBodymapRender();
  if (App.tab === 'tutorials') afterTutorialsRender();
  if (App.tab === 'assistant') afterAssistantRender();
}

function setTab(t) { App.tab = t; App.selectedClient = (t === 'clients') ? App.selectedClient : App.selectedClient; render(); }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let obRole = null;
function onboardingView() {
  return '<div class="wrap"><h1 class="page">Welcome to TheraByte</h1><p class="sub">Set up your profile to get started — it takes a few seconds.</p>' +
  '<div class="card" style="max-width:520px;">' +
    '<label>Your name</label><input type="text" id="ob-name" placeholder="e.g. Jordan Reyes" value="' + escapeHtml(App.name) + '">' +
    '<label>I am a…</label>' +
    '<div class="role-pick">' +
      '<div class="role-opt" id="role-therapist" onclick="pickRole(\'therapist\')"><strong>Therapist / practitioner</strong><span>Manage clients, schedule, and notes</span></div>' +
      '<div class="role-opt" id="role-client" onclick="pickRole(\'client\')"><strong>Client</strong><span>Book sessions and track how your body feels</span></div>' +
    '</div>' +
    '<div style="margin-top:22px;"><button class="btn" onclick="saveOnboarding()">Continue</button></div>' +
  '</div></div>';
}

function pickRole(r) { obRole = r; document.getElementById('role-therapist').classList.toggle('selected', r === 'therapist'); document.getElementById('role-client').classList.toggle('selected', r === 'client'); }
async function saveOnboarding() {
  const name = document.getElementById('ob-name').value.trim() || 'Guest';
  if (!obRole) { alert('Please choose whether you are a therapist or a client.'); return; }
  const profile = { name, role: obRole, createdAt: new Date().toISOString() };
  await DB.doc('profiles/' + App.uid).set(profile);
  App.profile = profile; App.name = name;
  render();
}
function editProfile() { App.profile = null; render(); setTimeout(() => { obRole = null; }, 0); }

function dashboardView() {
  return '<div id="dash-root"><h1 class="page">Hi, ' + escapeHtml(App.profile.name) + '.</h1><p class="sub">Here\'s what\'s ahead.</p><div class="grid2" id="dash-stats"><div class="card"><p class="empty">Loading…</p></div></div><div class="card" id="dash-next"><h3>Coming up</h3><p class="empty">Loading…</p></div></div>';
}

async function loadDashboard() {
  const field = App.profile.role === 'therapist' ? 'therapistId' : 'clientId';
  const q = DB.collection('appointments').where(field, '==', App.uid);
  const snap = await q.get();
  const now = new Date().toISOString();
  const upcoming = snap.docs.map(d => d.data()).filter(a => a.status === 'confirmed' && a.dateTime >= now).sort((a, b) => a.dateTime < b.dateTime ? -1 : 1);
  const distinctClients = new Set(snap.docs.map(d => d.data().clientId)).size;

  const statsHtml = App.profile.role === 'therapist'
    ? '<div class="card stat"><span class="num">' + upcoming.length + '</span><span class="lbl">Upcoming sessions</span></div><div class="card stat"><span class="num">' + distinctClients + '</span><span class="lbl">Clients seen</span></div>'
    : '<div class="card stat"><span class="num">' + upcoming.length + '</span><span class="lbl">Upcoming sessions</span></div><div class="card stat"><span class="num">—</span><span class="lbl">Take a moment to breathe</span></div>';
  const el1 = document.getElementById('dash-stats'); if (el1) el1.innerHTML = statsHtml;

  let nextHtml = '<h3>Coming up</h3>';
  if (upcoming.length === 0) { nextHtml += '<p class="empty">Nothing scheduled yet.</p>'; }
  else { nextHtml += upcoming.slice(0, 4).map(a => appointmentRow(a, false)).join(''); }
  const el2 = document.getElementById('dash-next'); if (el2) el2.innerHTML = nextHtml;
}

function appointmentRow(a, withActions) {
  const dt = new Date(a.dateTime);
  const dstr = dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const tstr = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const other = App.profile.role === 'therapist' ? a.clientName : a.therapistName;
  let actions = '';
  if (withActions && a.status === 'confirmed') {
    actions = '<div><button class="btn-danger" onclick="cancelAppt(\'' + a.id + '\')">Cancel</button></div>';
  }
  return '<div class="appt-row"><div><div class="appt-main">' + escapeHtml(other) + '</div><div class="appt-sub">' + dstr + ' · ' + tstr + '</div></div><div style="display:flex;align-items:center;gap:10px;"><span class="badge ' + a.status + '">' + a.status + '</span>' + actions + '</div></div>';
}

function calendarView() {
  if (App.profile.role === 'therapist') {
    return '<h1 class="page">Calendar</h1><p class="sub">Your upcoming and past sessions.</p><div class="card" id="cal-list"><p class="empty">Loading…</p></div>';
  }
  return '<h1 class="page">Book a session</h1><p class="sub">Choose a therapist and a time that works for you.</p>' +
  '<div class="card" style="max-width:520px;">' +
    '<label>Therapist</label><select id="bk-therapist"><option>Loading…</option></select>' +
    '<label>Date</label><input type="date" id="bk-date">' +
    '<label>Time</label><input type="time" id="bk-time">' +
    '<label>Note for your therapist (optional)</label><textarea id="bk-note" placeholder="Anything they should know before your session"></textarea>' +
    '<div style="margin-top:16px;"><button class="btn" onclick="bookAppointment()">Book appointment</button></div>' +
  '</div>' +
  '<div class="card"><h3>Your sessions</h3><div id="cal-list"><p class="empty">Loading…</p></div></div>';
}

async function loadCalendar() {
  if (App.profile.role === 'therapist') {
    const snap = await DB.collection('appointments').where('therapistId', '==', App.uid).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.dateTime < b.dateTime ? -1 : 1);
    const box = document.getElementById('cal-list');
    if (box) box.innerHTML = list.length ? list.map(a => appointmentRow(a, true)).join('') : '<p class="empty">No sessions yet.</p>';
    return;
  }
  const tsnap = await DB.collection('profiles').where('role', '==', 'therapist').get();
  App.therapists = tsnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sel = document.getElementById('bk-therapist');
  if (sel) { sel.innerHTML = App.therapists.length ? App.therapists.map(t => '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>').join('') : '<option value="">No therapists have joined yet</option>'; }
  const asnap = await DB.collection('appointments').where('clientId', '==', App.uid).get();
  const list = asnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.dateTime < b.dateTime ? -1 : 1);
  const box = document.getElementById('cal-list');
  if (box) box.innerHTML = list.length ? list.map(a => appointmentRow(a, true)).join('') : '<p class="empty">No sessions booked yet.</p>';
}

async function bookAppointment() {
  const tid = document.getElementById('bk-therapist').value;
  const date = document.getElementById('bk-date').value;
  const time = document.getElementById('bk-time').value;
  const note = document.getElementById('bk-note').value.trim();
  if (!tid || !date || !time) { alert('Please choose a therapist, date, and time.'); return; }
  const therapist = App.therapists.find(t => t.id === tid);
  const dateTime = new Date(date + 'T' + time).toISOString();
  await DB.collection('appointments').add({
    therapistId: tid, therapistName: therapist ? therapist.name : 'Therapist',
    clientId: App.uid, clientName: App.profile.name,
    dateTime, note, status: 'confirmed', createdAt: new Date().toISOString()
  });
  await loadCalendar();
}

async function cancelAppt(id) {
  await DB.doc('appointments/' + id).update({ status: 'cancelled' });
  render();
}

function clientsView() {
  return '<h1 class="page">Your clients</h1><p class="sub">Everyone who has booked with you.</p><div class="card" id="clients-list"><p class="empty">Loading…</p></div>';
}

async function loadClients() {
  const snap = await DB.collection('appointments').where('therapistId', '==', App.uid).get();
  const map = {};
  snap.docs.forEach(d => { const a = d.data(); if (!map[a.clientId]) map[a.clientId] = { id: a.clientId, name: a.clientName, count: 0 }; map[a.clientId].count++; });
  const clients = Object.values(map);
  const box = document.getElementById('clients-list');
  if (!box) return;
  if (!clients.length) { box.innerHTML = '<p class="empty">No clients yet — once someone books with you, they\'ll show up here.</p>'; return; }
  box.innerHTML = clients.map(c => '<div class="client-row"><div><div class="appt-main">' + escapeHtml(c.name) + '</div><div class="appt-sub">' + c.count + ' session' + (c.count === 1 ? '' : 's') + '</div></div><button class="btn-ghost btn-small" onclick="viewClientMap(\'' + c.id + '\',\'' + escapeHtml(c.name).replace(/'/g, "'") + '\')">View body map</button></div>').join('');
}

function viewClientMap(id, name) { App.selectedClient = { id, name }; App.tab = 'bodymap'; render(); }

const BODY_PARTS = {
  front: [
    { id: 'head', label: 'Head', shape: '<circle class="bodypart" data-part="head" cx="150" cy="42" r="26"/>' },
    { id: 'neck', label: 'Neck', shape: '<rect class="bodypart" data-part="neck" x="138" y="66" width="24" height="16" rx="6"/>' },
    { id: 'l_shoulder', label: 'Left shoulder', shape: '<circle class="bodypart" data-part="l_shoulder" cx="102" cy="102" r="18"/>' },
    { id: 'r_shoulder', label: 'Right shoulder', shape: '<circle class="bodypart" data-part="r_shoulder" cx="198" cy="102" r="18"/>' },
    { id: 'chest', label: 'Chest', shape: '<rect class="bodypart" data-part="chest" x="112" y="88" width="76" height="66" rx="18"/>' },
    { id: 'abdomen', label: 'Abdomen', shape: '<rect class="bodypart" data-part="abdomen" x="116" y="156" width="68" height="56" rx="14"/>' },
    { id: 'l_arm', label: 'Left arm', shape: '<rect class="bodypart" data-part="l_arm" x="72" y="106" width="24" height="118" rx="12"/>' },
    { id: 'r_arm', label: 'Right arm', shape: '<rect class="bodypart" data-part="r_arm" x="204" y="106" width="24" height="118" rx="12"/>' },
    { id: 'l_hip', label: 'Left hip', shape: '<rect class="bodypart" data-part="l_hip" x="112" y="214" width="40" height="34" rx="12"/>' },
    { id: 'r_hip', label: 'Right hip', shape: '<rect class="bodypart" data-part="r_hip" x="148" y="214" width="40" height="34" rx="12"/>' },
    { id: 'l_leg', label: 'Left leg', shape: '<rect class="bodypart" data-part="l_leg" x="118" y="250" width="30" height="170" rx="14"/>' },
    { id: 'r_leg', label: 'Right leg', shape: '<rect class="bodypart" data-part="r_leg" x="152" y="250" width="30" height="170" rx="14"/>' }
  ],
  back: [
    { id: 'head', label: 'Back of head', shape: '<circle class="bodypart" data-part="head" cx="150" cy="42" r="26"/>' },
    { id: 'neck', label: 'Neck', shape: '<rect class="bodypart" data-part="neck" x="138" y="66" width="24" height="16" rx="6"/>' },
    { id: 'l_shoulder', label: 'Left shoulder', shape: '<circle class="bodypart" data-part="l_shoulder" cx="102" cy="102" r="18"/>' },
    { id: 'r_shoulder', label: 'Right shoulder', shape: '<circle class="bodypart" data-part="r_shoulder" cx="198" cy="102" r="18"/>' },
    { id: 'upper_back', label: 'Upper back', shape: '<rect class="bodypart" data-part="upper_back" x="112" y="88" width="76" height="60" rx="18"/>' },
    { id: 'lower_back', label: 'Lower back', shape: '<rect class="bodypart" data-part="lower_back" x="116" y="150" width="68" height="62" rx="14"/>' },
    { id: 'l_arm', label: 'Left arm', shape: '<rect class="bodypart" data-part="l_arm" x="72" y="106" width="24" height="118" rx="12"/>' },
    { id: 'r_arm', label: 'Right arm', shape: '<rect class="bodypart" data-part="r_arm" x="204" y="106" width="24" height="118" rx="12"/>' },
    { id: 'l_hip', label: 'Left hip', shape: '<rect class="bodypart" data-part="l_hip" x="112" y="214" width="40" height="34" rx="12"/>' },
    { id: 'r_hip', label: 'Right hip', shape: '<rect class="bodypart" data-part="r_hip" x="148" y="214" width="40" height="34" rx="12"/>' },
    { id: 'l_leg', label: 'Left leg', shape: '<rect class="bodypart" data-part="l_leg" x="118" y="250" width="30" height="170" rx="14"/>' },
    { id: 'r_leg', label: 'Right leg', shape: '<rect class="bodypart" data-part="r_leg" x="152" y="250" width="30" height="170" rx="14"/>' }
  ]
};
let holoView = 'front';
let holoPoints = {};
let holoSelectedPart = null;
let holoTargetUid = null;
let holoReadonly = false;

function bodymapShell() {
  holoTargetUid = App.profile.role === 'therapist' && App.selectedClient ? App.selectedClient.id : App.uid;
  holoReadonly = App.profile.role === 'therapist';
  const targetLabel = App.profile.role === 'therapist'
    ? (App.selectedClient ? escapeHtml(App.selectedClient.name) + '\'s body map (read-only)' : 'Select a client from the Clients tab to view their body map')
    : 'Tap a part of the body to log how it feels';
  if (App.profile.role === 'therapist' && !App.selectedClient) {
    return '<h1 class="page">Body map</h1><p class="sub">' + targetLabel + '</p>';
  }
  return '<h1 class="page">Body map</h1><p class="sub">' + targetLabel + '</p>' +
  '<div class="holo-panel">' +
    '<div class="holo-head"><h3>' + (holoReadonly ? escapeHtml(App.selectedClient.name) : 'You') + '</h3>' +
      '<div class="holo-toggle"><button id="holo-front-btn" class="active" onclick="setHoloView(\'front\')">Front</button><button id="holo-back-btn" onclick="setHoloView(\'back\')">Back</button></div>' +
    '</div>' +
    '<div class="holo-stage"><div class="holo-ring"></div><div class="holo-ring r2"></div><svg id="holo-svg" viewBox="0 0 300 440" width="260" height="380"></svg></div>' +
    '<div class="holo-legend"><span><i class="dot" style="background:var(--lvl-mild)"></i>Mild</span><span><i class="dot" style="background:var(--lvl-mod)"></i>Moderate</span><span><i class="dot" style="background:var(--lvl-severe)"></i>Severe</span></div>' +
    '<div id="holo-editor"></div>' +
    '<div id="holo-points" class="points-list"></div>' +
  '</div>';
}

async function afterBodymapRender() {
  if (App.profile.role === 'therapist' && !App.selectedClient) return;
  const snap = await DB.doc('bodymap/' + holoTargetUid).get();
  holoPoints = (snap.exists && snap.data().points) ? snap.data().points : {};
  holoSelectedPart = null;
  drawHolo();
}

function setHoloView(v) {
  holoView = v; holoSelectedPart = null;
  document.getElementById('holo-front-btn').classList.toggle('active', v === 'front');
  document.getElementById('holo-back-btn').classList.toggle('active', v === 'back');
  drawHolo();
}

function levelClass(part) { const p = holoPoints[part]; return p && p.level ? ' lvl-' + p.level : ''; }
function drawHolo() {
  const parts = BODY_PARTS[holoView];
  const svg = document.getElementById('holo-svg');
  svg.innerHTML = parts.map(p => p.shape.replace('class="bodypart"', 'class="bodypart' + levelClass(p.id) + '"').replace('data-part="' + p.id + '"', 'data-part="' + p.id + '" onclick="selectPart(\'' + p.id + '\')"')).join('');
  renderHoloEditor();
  renderHoloPoints();
}

function selectPart(id) { if (holoReadonly) { holoSelectedPart = id; renderHoloEditor(true); return; } holoSelectedPart = id; renderHoloEditor(); }
function renderHoloEditor(readonlyPeek) {
  const box = document.getElementById('holo-editor');
  if (!holoSelectedPart) { box.innerHTML = ''; return; }
  const parts = BODY_PARTS[holoView];
  const meta = parts.find(p => p.id === holoSelectedPart);
  const current = holoPoints[holoSelectedPart] || {};
  if (holoReadonly) {
    const guideLink = GUIDE_FOR_PART[holoSelectedPart] ? '<div style="margin-top:8px;"><a href="#" onclick="openTutorialForPart(\'' + holoSelectedPart + '\');return false;" style="color:var(--holo-glow);font-weight:600;font-size:0.85rem;">See the self-massage guide for this area →</a></div>' : '';
    box.innerHTML = '<div class="editor-box"><h4>' + meta.label + '</h4>' +
      (current.level ? '<div>Level: <b>' + current.level + '</b></div>' + (current.note ? '<div class="readonly-note">"' + escapeHtml(current.note) + '"</div>' : '') : '<div class="readonly-note">Nothing logged here.</div>') + guideLink +
    '</div>';
    return;
  }
  const lvl = current.level || '';
  const guideLink = GUIDE_FOR_PART[holoSelectedPart] ? '<div style="margin-bottom:12px;"><a href="#" onclick="openTutorialForPart(\'' + holoSelectedPart + '\');return false;" style="color:var(--holo-glow);font-weight:600;font-size:0.85rem;">See a self-massage guide for this area →</a></div>' : '';
  box.innerHTML = '<div class="editor-box"><h4>' + meta.label + '</h4>' + guideLink +
    '<div class="lvl-btns">' +
      ['none', 'mild', 'moderate', 'severe'].map(l => '<button class="' + (lvl === l || (l === 'none' && !lvl) ? 'on' : '') + '" onclick="setPartLevel(\'' + (l === 'none' ? '' : l) + '\')">' + l + '</button>').join('') +
    '</div>' +
    '<textarea id="holo-note" placeholder="Optional note (what it feels like, when it started…)">' + escapeHtml(current.note || '') + '</textarea>' +
    '<div class="editor-actions"><button class="btn btn-small" onclick="savePartNote()">Save</button><button class="btn-ghost btn-small" onclick="holoSelectedPart=null;renderHoloEditor();" style="border-color:rgba(143,224,230,0.4);color:#EAF7F8;">Close</button></div>' +
  '</div>';
}
let pendingLevel = null;
function setPartLevel(l) { pendingLevel = l; renderHoloEditorLevelOnly(l); }
function renderHoloEditorLevelOnly(l) {
  document.querySelectorAll('.lvl-btns button').forEach(b => b.classList.remove('on'));
  const idx = ['', 'mild', 'moderate', 'severe'].indexOf(l);
  const btns = document.querySelectorAll('.lvl-btns button');
  if (btns[idx === -1 ? 0 : idx]) btns[idx === -1 ? 0 : idx].classList.add('on');
}
async function savePartNote() {
  const note = document.getElementById('holo-note').value.trim();
  const level = pendingLevel !== null ? pendingLevel : (holoPoints[holoSelectedPart] || {}).level || '';
  const data = { points: {} };
  data.points[holoSelectedPart] = { level: level || null, note, view: holoView, updatedAt: new Date().toISOString() };
  const ref = DB.doc('bodymap/' + holoTargetUid);
  const snap = await ref.get();
  if (snap.exists) await ref.update(data); else await ref.set(data);
  holoPoints[holoSelectedPart] = data.points[holoSelectedPart];
  pendingLevel = null; holoSelectedPart = null;
  drawHolo();
}
function renderHoloPoints() {
  const box = document.getElementById('holo-points');
  const entries = Object.keys(holoPoints).filter(k => holoPoints[k] && holoPoints[k].level).map(k => ({ id: k, ...holoPoints[k] }));
  if (!entries.length) { box.innerHTML = ''; return; }
  const allParts = BODY_PARTS.front.concat(BODY_PARTS.back);
  box.innerHTML = '<h4 style="color:var(--holo-glow);margin:14px 0 4px;font-size:0.9rem;">Logged areas</h4>' + entries.map(e => {
    const meta = allParts.find(p => p.id === e.id) || { label: e.id };
    return '<div class="point-item"><b>' + meta.label + '</b> — ' + e.level + (e.note ? ': ' + escapeHtml(e.note) : '') + '</div>';
  }).join('');
}

const TUTORIALS = [
  { id: 'neck_shoulders', title: 'Neck & shoulders', parts: ['neck', 'l_shoulder', 'r_shoulder'], intro: 'For everyday tightness from screens, driving, or stress.', steps: [ 'Sit tall and relax your shoulders away from your ears.', 'Reach one hand across to the opposite shoulder and squeeze the muscle between fingers and thumb for 20–30 seconds.', 'Using your fingertips, make small circular motions along the top of the shoulder, moving from the base of the neck outward.', 'Gently tilt your head to one side, then use your hand to add light, brief pressure — never force the stretch.', 'Repeat on the other side. Finish with a few slow shoulder rolls.' ], caution: 'Skip this if you have a recent neck injury, numbness, or shooting pain down an arm — see a professional instead.' },
  { id: 'upper_back', title: 'Upper back', parts: ['chest', 'upper_back'], intro: 'Eases tightness between the shoulder blades.', steps: [ 'Stand with feet hip-width apart, or sit tall.', 'Reach one arm across your chest and use the other hand to press gently along the muscle just below the shoulder blade.', 'Alternatively, place a tennis ball between your upper back and a wall, and gently shift your weight to roll it over tight spots.', 'Hold on any tender spot for 15–20 seconds, breathing slowly, then move on.', 'Finish with a gentle chest-opening stretch: clasp hands behind your back and lift slightly.' ], caution: 'Use light pressure at first. Stop if you feel sharp pain, tingling, or numbness.' },
  { id: 'lower_back', title: 'Lower back', parts: ['abdomen', 'lower_back', 'l_hip', 'r_hip'], intro: 'For general stiffness after sitting or light activity.', steps: [ 'Lie on your back with knees bent, feet flat on the floor.', 'Gently rock your knees side to side in a small, slow motion.', 'Bring one knee toward your chest and hold for 20–30 seconds, then switch sides.', 'Move onto hands and knees for a slow cat-cow: arch and round your back gently with your breath.', 'Avoid deep pressure on the lower back by yourself — use broad, gentle strokes only.' ], caution: 'Never push through sharp pain, and avoid self-massage on the lower back if pain radiates down a leg — book a session instead.' },
  { id: 'hands_arms', title: 'Hands & forearms', parts: ['l_arm', 'r_arm'], intro: 'Helpful after typing, lifting, or repetitive hand use.', steps: [ 'Hold one forearm with the opposite hand and gently squeeze along its length, from wrist to elbow.', 'Turn your palm up and use your thumb to press small circles into the fleshy part of the forearm.', 'Gently stretch the wrist by pulling the fingers back toward you, holding 15–20 seconds.', 'Massage each finger from base to tip with a light pinch-and-slide motion.', 'Repeat on the other side.' ], caution: 'Ease off around joints, and stop if you feel tingling or numbness in the fingers.' },
  { id: 'legs_feet', title: 'Legs & feet', parts: ['l_leg', 'r_leg'], intro: 'Good for tired or achy legs after standing or walking.', steps: [ 'Sit comfortably and rest one ankle on the opposite knee.', 'Use both thumbs to press and glide along the sole of the foot, from heel to toes.', 'Move up to the calf: use a gentle squeezing, kneading motion with both hands.', 'For the thigh, use long, slow strokes moving toward the heart rather than away from it.', 'Repeat on the other leg, then stand and gently shake out both legs.' ], caution: 'Avoid firm pressure directly on varicose veins or any area that is swollen, bruised, or recently injured.' },
  { id: 'head_temples', title: 'Head & temples', parts: ['head'], intro: 'A quick reset for tension headaches.', steps: [ 'Use your fingertips to make small, slow circles at the temples for 30 seconds.', 'Walk your fingertips across the scalp from the hairline to the base of the skull, pressing gently.', 'Press lightly at the base of the skull, where it meets the neck, and hold for 20 seconds.', 'Gently massage the jaw muscles just in front of the ears — this is a common hidden source of head tension.', 'Finish with a few slow, deep breaths.' ], caution: 'See a doctor for frequent, severe, or sudden-onset headaches — self-massage is for everyday tension only.' }
];
const GUIDE_FOR_PART = {};
TUTORIALS.forEach(t => t.parts.forEach(p => GUIDE_FOR_PART[p] = t.id));
let tutorialFocus = null;

function tutorialsView() {
  return '<h1 class="page">Self-massage guides</h1><p class="sub">Gentle techniques you can try between sessions. These are general tips, not a substitute for professional care — stop if anything causes sharp pain.</p>' +
  '<div id="tutorial-list">' + TUTORIALS.map(t => tutorialCard(t)).join('') + '</div>';
}

function tutorialCard(t) {
  const open = tutorialFocus === t.id;
  return '<div class="card tutorial-card" id="tut-' + t.id + '">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleTutorial(\'' + t.id + '\')">' +
      '<h3 style="margin:0;">' + t.title + '</h3><span style="color:var(--sage-deep);font-weight:700;">' + (open ? '–' : '+') + '</span>' +
    '</div>' +
    (open ? '<p class="sub" style="margin:10px 0 14px;">' + t.intro + '</p>' +
      '<ol style="margin:0 0 14px;padding-left:20px;line-height:1.7;">' + t.steps.map(s => '<li>' + s + '</li>').join('') + '</ol>' +
      '<div class="notice" style="margin:0;">' + t.caution + '</div>'
      : '<p class="sub" style="margin:8px 0 0;">' + t.intro + '</p>') +
  '</div>';
}

function toggleTutorial(id) { tutorialFocus = tutorialFocus === id ? null : id; App.tab = 'tutorials'; render(); setTimeout(() => { const c = document.getElementById('tut-' + id); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }
function afterTutorialsRender() {}
function openTutorialForPart(partId) {
  const gid = GUIDE_FOR_PART[partId];
  if (!gid) return;
  tutorialFocus = gid; App.tab = 'tutorials'; render();
  setTimeout(() => { const c = document.getElementById('tut-' + gid); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
}
const ASSISTANT_RULES = "You are TheraByte's gentle wellness assistant, built into a practice-management app for therapists and massage practitioners and their clients. Offer warm, practical self-care and stretching suggestions, brief explanations of common muscle-tension causes, and encouragement to book a session with a licensed practitioner for anything persistent or severe. You are not a doctor: never diagnose a condition, never suggest medication, and always recommend professional care for serious, worsening, or unclear symptoms. Keep replies concise (under 120 words), warm, and easy to read.";

function assistantView() {
  return '<h1 class="page">Wellness assistant</h1><p class="sub">Ask about stretches, easing tension, or getting ready for a session. This isn\'t a substitute for professional care.</p>' +
  '<div class="chat-window"><div class="chat-scroll" id="chat-scroll"></div>' +
  '<div class="chat-input-row"><textarea id="chat-input" placeholder="e.g. My shoulders are tight after sitting all day — any quick stretches?"></textarea><button class="btn" id="chat-send" onclick="sendChat()">Send</button></div></div>';
}

function afterAssistantRender() { renderChat(); }
const CANNED_TIPS = [
  { kw: ['shoulder', 'neck', 'desk', 'sitting', 'computer'], tip: "Tight shoulders and neck are common after long stretches at a desk. Try this: roll your shoulders back 10 times, then gently tilt your ear toward one shoulder and hold for 20 seconds, then the other side. Standing up every 30–45 minutes helps a lot too." },
  { kw: ['back', 'lower back', 'spine'], tip: "For lower back tightness, try a gentle knee-to-chest stretch lying down, holding each side for 20–30 seconds, plus a slow cat-cow stretch on hands and knees. Avoid twisting or heavy lifting until it eases, and see a practitioner if it's sharp or spreading down a leg." },
  { kw: ['leg', 'calf', 'thigh', 'hamstring'], tip: "For leg tightness, a standing calf stretch against a wall and a seated hamstring stretch (reaching gently toward your toes with a straight back) can help. Hold each for 20–30 seconds and breathe slowly." },
  { kw: ['stress', 'anxious', 'tense', 'overwhelmed'], tip: "When stress shows up as physical tension, a few slow breaths — in for 4 counts, out for 6 — can help your shoulders and jaw unclench. Pairing that with a short walk or a warm shower before a session often makes the massage itself more effective." },
  { kw: ['headache', 'head', 'migraine'], tip: "Tension headaches often trace back to the neck and jaw. Gentle self-massage at the base of the skull, plus staying hydrated and taking screen breaks, can help. If headaches are frequent or severe, it's worth mentioning to a doctor as well as your therapist." }
];

function cannedReply(text) {
  const lower = text.toLowerCase();
  const hit = CANNED_TIPS.find(t => t.kw.some(k => lower.includes(k)));
  const base = hit ? hit.tip : "Gentle movement, hydration, and short breaks from repetitive positions go a long way for everyday muscle tension. For anything persistent, sharp, or getting worse, it's best to book a session with a practitioner or check with a doctor.";
  return base + "\n\n(This public demo answers with general tips rather than live AI — open TheraByte inside Claude for the real assistant.)";
}

function renderChat() {
  const scroll = document.getElementById('chat-scroll');
  if (!scroll) return;
  if (!App.chat.length) { scroll.innerHTML = '<div class="msg assistant">Hi! I\'m here to help with gentle self-care tips between sessions. What\'s going on?</div>'; return; }
  scroll.innerHTML = App.chat.map(m => '<div class="msg ' + m.role + '">' + escapeHtml(m.content) + '</div>').join('');
  scroll.scrollTop = scroll.scrollHeight;
}

async function sendChat() {
  if (App.busy) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  App.chat.push({ role: 'user', content: text });
  App.chat.push({ role: 'assistant', content: '' });
  renderChat();
  App.busy = true;
  document.getElementById('chat-send').disabled = true;
  if (!SAMPLE) {
    await new Promise(r => setTimeout(r, 350));
    App.chat[App.chat.length - 1].content = cannedReply(text);
    App.busy = false;
    const btn0 = document.getElementById('chat-send'); if (btn0) btn0.disabled = false;
    renderChat();
    return;
  }
  try {
    const turns = [{ role: 'user', content: ASSISTANT_RULES }, { role: 'assistant', content: 'Understood — I\'m ready to help.' }]
      .concat(App.chat.slice(0, -1));
    const result = await SAMPLE(turns, { onText: ({ text }) => { App.chat[App.chat.length - 1].content = text; renderChat(); } });
    App.chat[App.chat.length - 1].content = result.text;
  } catch (e) {
    App.chat[App.chat.length - 1].content = e.text || "I couldn't respond just now — please try again in a moment.";
  }
  App.busy = false;
  const btn = document.getElementById('chat-send'); if (btn) btn.disabled = false;
  renderChat();
}

const _origRender = render;
render = function () {
  _origRender();
  if (!App.profile) return;
  if (App.tab === 'dashboard') loadDashboard();
  else if (App.tab === 'calendar') loadCalendar();
  else if (App.tab === 'clients') loadClients();
};

boot();
