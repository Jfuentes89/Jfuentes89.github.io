// ══════════════════════════════════════════════
//  TRANSPORTES MELGAR — Lógica de la aplicación
// ══════════════════════════════════════════════

// ── TEMA (ejecutar antes del DOM para evitar flash) ──
(function () {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

// ══════════════════════════════════════════════
//  ESTADO GLOBAL — Caché en memoria + Firebase
// ══════════════════════════════════════════════
const ADMIN_DEFAULT = { id: 'c0', nombre: 'Administrador', username: 'admin', password: 'admin123', rol: 'admin' };

// Caché local (se sincroniza con Firestore)
const _cache = { choferes: [], unidades: [], reportes: [], agenda: [] };

// Sesión: solo en localStorage (no viaja a la nube)
const _mem = {};
const _sessionStore = {
  getItem: k => { try { return localStorage.getItem(k); } catch(e) { return _mem[k] || null; } },
  setItem: (k,v) => { try { localStorage.setItem(k,v); } catch(e) { _mem[k]=v; } },
  removeItem: k => { try { localStorage.removeItem(k); } catch(e) { delete _mem[k]; } },
};
const _store = _sessionStore; // alias para compatibilidad

const DB = {
  get choferes()  { return _cache.choferes; },
  get unidades()  { return _cache.unidades; },
  get reportes()  { return _cache.reportes; },
  get agenda()    { return _cache.agenda;   },
  get sesion()    { return JSON.parse(_sessionStore.getItem('sesionActual') || 'null'); },
  set sesion(v)   { 
    if (v === null) _sessionStore.removeItem('sesionActual');
    else _sessionStore.setItem('sesionActual', JSON.stringify(v)); 
  },
};

// ── Esperar a que Firebase esté listo (polling robusto) ──
const _fbReady = new Promise((resolve, reject) => {
  let intentos = 0;
  const check = () => {
    if (window._firebaseReady && window._db) {
      resolve();
    } else if (intentos++ > 100) { // 5 segundos máximo
      reject(new Error('Firebase no cargó a tiempo'));
    } else {
      setTimeout(check, 50);
    }
  };
  check();
});

// ── Helpers Firestore (API compat) ──
function _fdb() { return window._db; }

async function fsGetAll(col) {
  const snap = await _fdb().collection(col).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fsSet(col, id, data) {
  const d = { ...data }; delete d.id;
  await _fdb().collection(col).doc(id).set(d);
}

async function fsDelete(col, id) {
  await _fdb().collection(col).doc(id).delete();
}

// ── Suscripciones en tiempo real ──
// ══════════════════════════════════════════════
//  NOTIFICACIONES AL CHOFER
// ══════════════════════════════════════════════
function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Dos tonos cortos tipo "ping"
    [0, 220].forEach(delay => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime + delay / 1000);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + delay / 1000 + 0.1);
      gain.gain.setValueAtTime(0.4, ctx.currentTime + delay / 1000);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay / 1000 + 0.35);
      osc.start(ctx.currentTime + delay / 1000);
      osc.stop(ctx.currentTime + delay / 1000 + 0.35);
    });
  } catch(e) { /* AudioContext no disponible */ }
}

async function notificarChofer(viaje) {
  playNotifSound();
  // Notificación del sistema si el usuario la autorizó
  if (Notification.permission === 'granted') {
    new Notification('🚛 Nuevo viaje asignado', {
      body: `${viaje.cliente} → ${viaje.destino}\nFecha: ${fmtDate(viaje.fecha)}${viaje.hora ? ' · ' + viaje.hora : ''}`,
      icon: 'https://jfuentes89.github.io/favicon.ico',
      tag:  'viaje-' + viaje.id,
    });
  }
  // Toast visible dentro de la app
  toast('🚛 Nuevo viaje asignado: ' + viaje.cliente + ' → ' + viaje.destino, 'success');
}

function pedirPermisoNotificacion() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function subscribeAll() {
  const db = _fdb();

  db.collection('choferes').onSnapshot(snap => {
    _cache.choferes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!_cache.choferes.find(c => c.id === 'c0')) _cache.choferes.unshift(ADMIN_DEFAULT);
    const pg = document.querySelector('.page.active');
    if (pg && pg.id === 'page-admin') renderAdmin();
    if (pg && pg.id === 'page-nuevo-reporte') initForm();
  });

  db.collection('unidades').onSnapshot(snap => {
    _cache.unidades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pg = document.querySelector('.page.active');
    if (pg && pg.id === 'page-admin') renderAdmin();
    if (pg && pg.id === 'page-nuevo-reporte') initForm();
  });

  db.collection('reportes').orderBy('fecha', 'desc').onSnapshot(snap => {
    _cache.reportes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pg = document.querySelector('.page.active');
    if (pg && pg.id === 'page-dashboard') renderDashboard();
    if (pg && pg.id === 'page-historial') renderHistorial();
  });

  // Reset diario: limpiar viajes 'completado' de días anteriores del caché visual
  // (no se borran de Firestore, solo no se muestran en el resumen de hoy)
  db.collection('agenda').orderBy('fecha', 'asc').onSnapshot(snap => {
    const prevIds   = new Set((_cache.agenda || []).map(v => v.id));
    const nuevos    = snap.docChanges().filter(c => c.type === 'added' || c.type === 'modified');
    const sesion    = DB.sesion;
    _cache.agenda   = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Notificar al chofer si le asignaron un viaje nuevo o recién asignado
    if (sesion && sesion.rol === 'chofer') {
      nuevos.forEach(c => {
        const v = { id: c.doc.id, ...c.doc.data() };
        // Solo si este viaje es para este chofer, tiene estado 'pendiente' y antes no existía o no tenía chofer
        if (v.chorerId === sesion.id && v.estado === 'pendiente') {
          const eraDesconocido = !prevIds.has(v.id);
          const prev = (_cache.agenda || []).find(x => x.id === v.id);
          const recienAsignado = prev && !prev.chorerId && v.chorerId;
          if (eraDesconocido || recienAsignado) {
            notificarChofer(v);
          }
        }
      });
    }

    const pg = document.querySelector('.page.active');
    if (pg && pg.id === 'page-agenda')    renderAgenda();
    if (pg && pg.id === 'page-dashboard') renderDashboard();
    // Si el chofer tiene el dashboard activo, siempre actualizar sus tarjetas de viajes
    const sesionActual = DB.sesion;
    if (sesionActual && sesionActual.rol === 'chofer') {
      const container = document.getElementById('viajes-asignados-container');
      if (container) container.innerHTML = renderViajesChofer(sesionActual);
    }
  });
}

// ── Carga inicial + suscripciones ──
async function initDefaults() {
  await _fbReady;

  const [choferes, unidades, reportes, agenda] = await Promise.all([
    fsGetAll('choferes'),
    fsGetAll('unidades'),
    fsGetAll('reportes'),
    fsGetAll('agenda'),
  ]);

  _cache.choferes = choferes;
  _cache.unidades = unidades;
  _cache.reportes = reportes;
  _cache.agenda   = agenda;

  if (!_cache.choferes.find(c => c.id === 'c0')) {
    await fsSet('choferes', 'c0', ADMIN_DEFAULT);
    _cache.choferes.unshift(ADMIN_DEFAULT);
  }

  subscribeAll();
}

// ══════════════════════════════════════════════
//  UTILIDADES
// ══════════════════════════════════════════════
const uid = () => 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

const fmt = n =>
  '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = d => {
  if (!d) return '—';
  const p = d.split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
};

// Convierte "HH:MM" (24h) a "hh:MM a. m./p. m." (12h)
const fmtHora = h => {
  if (!h) return '—';
  const [hh, mm] = h.split(':').map(Number);
  const ampm = hh < 12 ? 'a. m.' : 'p. m.';
  const h12  = hh % 12 || 12;
  return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
};

function toast(msg, type = 'info') {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  t.innerHTML = `<span style="font-weight:700">${icons[type] || '•'}</span>${msg}`;
  tc.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut .3s forwards';
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

function openModal(id)  {
  document.getElementById(id).classList.add('show');
  if (id === 'modal-finalizados') renderAgendaFinalizados();
}
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ══════════════════════════════════════════════
//  AUTENTICACIÓN
// ══════════════════════════════════════════════
async function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  if (!u || !p) { toast('Completa todos los campos', 'warning'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Conectando...';

  try {
    // 1. Esperar Firebase
    await _fbReady;

    // 2. Cargar choferes si no están en caché
    if (!_cache.choferes.length) {
      const lista = await fsGetAll('choferes');
      _cache.choferes = lista;
      if (!_cache.choferes.find(c => c.id === 'c0')) _cache.choferes.unshift(ADMIN_DEFAULT);
    }

    // 3. Verificar credenciales (primero BD, luego fallback admin hardcodeado)
    const chofer = _cache.choferes.find(c => c.username === u && c.password === p)
                 || (u === ADMIN_DEFAULT.username && p === ADMIN_DEFAULT.password ? ADMIN_DEFAULT : null);

    if (!chofer) { toast('Credenciales incorrectas', 'error'); return; }

    // 4. Guardar sesión y cargar todo
    DB.sesion = { id: chofer.id, nombre: chofer.nombre, username: chofer.username, rol: chofer.rol };
    await initDefaults();
    showApp();

  } catch(err) {
    console.error('Login error:', err);
    toast('Error de conexión. Intenta de nuevo.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Iniciar Sesión';
  }
}

function doLogout() {
  DB.sesion = null;
  if (window._clockInterval) { clearInterval(window._clockInterval); window._clockInterval = null; }

  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  toast('Sesión cerrada', 'info');
}

function showApp() {
  const sesion = DB.sesion;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-name-display').textContent = sesion.nombre;
  document.getElementById('user-role-display').textContent = sesion.rol === 'admin' ? 'Administrador' : 'Chofer';
  document.getElementById('user-avatar').textContent = sesion.nombre.charAt(0).toUpperCase();
  document.getElementById('nav-admin').style.display  = sesion.rol === 'admin' ? 'flex' : 'none';
  document.getElementById('nav-agenda').style.display = sesion.rol === 'admin' ? 'flex' : 'none';
  // Bottom nav: agenda y admin solo para admin
  const bnavAgenda = document.getElementById('bnav-agenda');
  const bnavAdmin  = document.getElementById('bnav-admin');
  if (bnavAgenda) bnavAgenda.style.display = sesion.rol === 'admin' ? 'flex' : 'none';
  if (bnavAdmin)  bnavAdmin.style.display  = sesion.rol === 'admin' ? 'flex' : 'none';

  // Historial: ocultar filtros y botón PDF para rol chofer
  const esAdmin = sesion.rol === 'admin';
  document.getElementById('btn-export-pdf').style.display = esAdmin ? '' : 'none';
  document.getElementById('filtros-card').style.display   = esAdmin ? '' : 'none';

  navigate('dashboard');
  // Pedir permiso de notificaciones (solo choferes)
  if (sesion.rol === 'chofer') pedirPermisoNotificacion();
  // Iniciar reloj
  if (window._clockInterval) clearInterval(window._clockInterval);
  function _tickClock() {
    const el = document.getElementById('dash-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }
  _tickClock();
  window._clockInterval = setInterval(_tickClock, 1000);
}

// ══════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const map = {
    'dashboard':         'page-dashboard',
    'nuevo-reporte':     'page-nuevo-reporte',
    'historial':         'page-historial',
    'admin':             'page-admin',
    'agenda':            'page-agenda',
    'stats':             'page-stats',
    'cambiar-password':  'page-cambiar-password',
    'usuario':           'page-usuario',
  };

  const pg = document.getElementById(map[page]);
  if (pg) pg.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes(`'${page}'`))
      n.classList.add('active');
  });

  // Sincronizar bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  const bnavId = 'bnav-' + page.replace('-', '-');
  const bnavEl = document.getElementById('bnav-' + page);
  if (bnavEl) bnavEl.classList.add('active');
  // Caso especial nuevo-reporte → FAB
  if (page === 'nuevo-reporte') {
    const fab = document.getElementById('bnav-nuevo-reporte');
    if (fab) fab.classList.add('active');
  }

  // Cerrar sidebar en móvil
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open')) toggleSidebar();

  // Init específico de cada página
  if (page === 'dashboard')        renderDashboard();
  if (page === 'nuevo-reporte')    initForm();
  if (page === 'historial')        renderHistorial();
  if (page === 'admin')            renderAdmin();
  if (page === 'agenda')           renderAgenda();
  if (page === 'stats')            renderStats();
  if (page === 'usuario')          renderPaginaUsuario();

}

function openUserPanel() {
  const sesion = DB.sesion;
  if (sesion) {
    document.getElementById('upanel-nombre').textContent = sesion.nombre || '—';
    document.getElementById('upanel-rol').textContent    = sesion.rol === 'admin' ? 'Administrador' : 'Chofer';
    document.getElementById('upanel-avatar').textContent = (sesion.nombre || 'A').charAt(0).toUpperCase();
  }
  document.getElementById('user-panel').classList.add('show');
  document.getElementById('user-panel-overlay').classList.add('show');
  // Marcar botón activo en bottom-nav
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bnav-usuario');
  if (btn) btn.classList.add('active');
}

function closeUserPanel() {
  document.getElementById('user-panel').classList.remove('show');
  document.getElementById('user-panel-overlay').classList.remove('show');
  // Restaurar activo según página actual
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id.replace('page-', '');
    const bnavEl = document.getElementById('bnav-' + pageId);
    document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
    if (bnavEl) bnavEl.classList.add('active');
  }
}

// toggleSidebar — sin efecto (sidebar eliminado, mantenido por compatibilidad)
function toggleSidebar() {}

// ══════════════════════════════════════════════
//  TEMA
// ══════════════════════════════════════════════
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

// ══════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════
// Fecha local en formato YYYY-MM-DD sin desfase de timezone
function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderDashboard() {
  const sesion = DB.sesion;
  const esChofer = sesion.rol === 'chofer';

  // Filtrar al mes actual
  const ahora  = new Date();
  const mesAct = ahora.getMonth();      // 0-11
  const anioAct = ahora.getFullYear();

  let todosReportes = DB.reportes;
  if (esChofer) todosReportes = todosReportes.filter(r => r.chorerId === sesion.id);

  // Reportes del mes actual
  const reportesMes = todosReportes.filter(r => {
    if (!r.fecha) return false;
    const [y, m] = r.fecha.split('-').map(Number);
    return y === anioAct && (m - 1) === mesAct;
  });

  const nombreMes = ahora.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  // Saludo
  const h = ahora.getHours();
  document.getElementById('dash-greeting').textContent =
    (h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches') + ', ' + sesion.nombre;
  document.getElementById('dash-date').textContent =
    ahora.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  if (esChofer) {
    // ── VISTA CHOFER: solo total de pagos recibidos (flete + ingresos extra) del mes ──
    // Sumar solo los gastos con concepto "Pago de chófer"
    const totalPagoChofer = reportesMes.reduce((s, r) => {
      const g = (r.gastos || []).find(x => x.concepto && x.concepto.toLowerCase().includes('pago de ch'));
      return s + (g ? g.monto : 0);
    }, 0);
    const numViajes  = reportesMes.length;

    document.getElementById('metrics-grid').innerHTML = `
      <div class="metric-card income">
        <div class="metric-label">Pago de chófer — ${nombreMes}</div>
        <div class="metric-value">${fmt(totalPagoChofer)}</div>
        <div class="metric-sub">${numViajes} viaje${numViajes !== 1 ? 's' : ''} este mes</div>
      </div>
      <div class="metric-card trips">
        <div class="metric-label">Viajes este mes</div>
        <div class="metric-value">${numViajes}</div>
        <div class="metric-sub">${todosReportes.length} en total histórico</div>
      </div>
    `;

    // Ocultar barra de rentabilidad para chofer
    const barWrap = document.querySelector('.profit-bar-wrap');
    if (barWrap) barWrap.style.display = 'none';

  } else {
    // ── VISTA ADMIN: ingresos, gastos, utilidad y viajes del mes ──
    const totalI   = reportesMes.reduce((s, r) => s + r.subtotalIngresos, 0);
    const totalG   = reportesMes.reduce((s, r) => s + r.subtotalGastos,   0);
    const utilidad = totalI - totalG;
    const pct      = totalI > 0 ? Math.min(100, Math.round((utilidad / totalI) * 100)) : 0;
    const numViajes = reportesMes.length;

    document.getElementById('metrics-grid').innerHTML = `
      <div class="metric-card income">
        <div class="metric-label">Ingresos — ${nombreMes}</div>
        <div class="metric-value">${fmt(totalI)}</div>
        <div class="metric-sub">${numViajes} viaje${numViajes !== 1 ? 's' : ''} este mes</div>
      </div>
      <div class="metric-card expense">
        <div class="metric-label">Gastos — ${nombreMes}</div>
        <div class="metric-value">${fmt(totalG)}</div>
        <div class="metric-sub">acumulados del mes</div>
      </div>
      <div class="metric-card profit">
        <div class="metric-label">Utilidad Neta — ${nombreMes}</div>
        <div class="metric-value">${fmt(utilidad)}</div>
        <div class="metric-sub">${pct}% de rentabilidad</div>
      </div>
      <div class="metric-card trips">
        <div class="metric-label">Viajes este mes</div>
        <div class="metric-value">${numViajes}</div>
        <div class="metric-sub">${todosReportes.length} en total histórico</div>
      </div>
    `;

    const bar   = document.getElementById('profit-bar');
    const pctEl = document.getElementById('profit-pct');
    const barWrap = document.querySelector('.profit-bar-wrap');
    if (barWrap) barWrap.style.display = '';
    bar.style.width      = (pct < 0 ? 0 : pct) + '%';
    bar.style.background = pct < 0
      ? 'linear-gradient(90deg,#ef4444,#fca5a5)'
      : 'linear-gradient(90deg,#36B25F,#57D5D5)';
    pctEl.textContent = pct + '%';

    // ── Resumen agenda del día ──
    const hoy = localDateStr();
    const agendaHoy = DB.agenda.filter(v => v.fecha === hoy);
    const numAceptados       = agendaHoy.filter(v => v.estado === 'aceptado').length;
    const numEnRuta          = agendaHoy.filter(v => v.estado === 'en-ruta').length;
    const numPendReporte     = agendaHoy.filter(v => v.estado === 'pendiente-reporte').length;
    const numCompletados     = agendaHoy.filter(v => v.estado === 'completado').length;
    const numPendientes      = agendaHoy.filter(v => v.estado === 'pendiente').length;
    const resumenEl = document.getElementById('admin-agenda-resumen');
    if (resumenEl && agendaHoy.length > 0) {
      resumenEl.innerHTML = `
        <div style="font-size:.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.5rem;font-weight:600">Agenda de hoy</div>
        <div class="agenda-resumen">
          <div class="agenda-resumen-item">
            <span class="ar-num" style="color:var(--warning)">${numPendientes}</span>
            <span class="ar-label">Pendientes</span>
          </div>
          <div class="agenda-resumen-item">
            <span class="ar-num" style="color:#57D5D5">${numAceptados}</span>
            <span class="ar-label">Aceptados</span>
          </div>
          <div class="agenda-resumen-item">
            <span class="ar-num" style="color:#9D5DD9">${numEnRuta}</span>
            <span class="ar-label">En Ruta</span>
          </div>
        </div>`;
    } else if (resumenEl) {
      resumenEl.innerHTML = '';
    }
  }

  // ── Actividad reciente (últimos 5 del mes para ambos roles) ──
  const recientes = [...reportesMes]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 5);

  // Siempre actualizar tarjetas de viajes asignados para el chofer
  if (esChofer) {
    const viajesContainer = document.getElementById('viajes-asignados-container');
    if (viajesContainer) viajesContainer.innerHTML = renderViajesChofer(sesion);
  }

  const al = document.getElementById('activity-list');
  if (!recientes.length) {
    al.innerHTML = '<div class="empty-state"><p>Sin actividad registrada este mes.</p></div>';
    return;
  }

  if (esChofer) {
    al.innerHTML = recientes.map(r => `
      <div class="activity-item" onclick="showDetalle('${r.id}')">
        <div class="activity-badge" style="background:var(--success)"></div>
        <div class="activity-info">
          <strong>${r.cliente || 'Sin cliente'} — ${r.destino || ''}</strong>
          <span>${fmtDate(r.fecha)} · ${r.unidadPlaca}</span>
        </div>
        <div class="activity-amount positive">${fmt(r.subtotalIngresos)}</div>
      </div>`).join('');
  } else {
    al.innerHTML = recientes.map(r => {
      const pos = r.utilidad >= 0;
      return `<div class="activity-item" onclick="showDetalle('${r.id}')">
        <div class="activity-badge" style="background:${pos ? 'var(--success)' : 'var(--danger)'}"></div>
        <div class="activity-info">
          <strong>${r.cliente || 'Sin cliente'} — ${r.destino || ''}</strong>
          <span>${fmtDate(r.fecha)} · ${r.unidadPlaca} · ${r.choferNombre}</span>
        </div>
        <div class="activity-amount ${pos ? 'positive' : 'negative'}">${fmt(r.utilidad)}</div>
      </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════
//  FORMULARIO — NUEVO REPORTE
// ══════════════════════════════════════════════
function initForm() {
  const sesion   = DB.sesion;
  const choferes = DB.choferes;
  const unidades = DB.unidades;

  document.getElementById('r-fecha').value = localDateStr();

  // Chofer selector
  const cSel  = document.getElementById('r-chofer');
  const cGrp  = document.getElementById('r-chofer-group');
  if (sesion.rol === 'chofer') {
    cSel.innerHTML = `<option value="${sesion.id}">${sesion.nombre}</option>`;
    cSel.disabled  = true;
    cGrp.style.opacity = '.6';
  } else {
    cSel.disabled  = false;
    cGrp.style.opacity = '1';
    cSel.innerHTML = choferes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }

  // Unidades selector
  const uSel = document.getElementById('r-unidad');
  uSel.innerHTML = unidades.length
    ? unidades.map(u => `<option value="${u.id}">${u.modelo} (${u.placa})</option>`).join('')
    : '<option value="">Sin unidades registradas</option>';

  // Limpiar dinámicos
  document.getElementById('ingresos-extra').innerHTML = '';
  document.getElementById('gastos-list').innerHTML    = '';
  document.getElementById('r-flete').value            = '';
  const gd = document.getElementById('g-diesel');      if (gd) gd.value = '';
  const gp = document.getElementById('g-pago-chofer'); if (gp) gp.value = '';
  document.getElementById('r-cliente').value          = '';
  document.getElementById('r-destino').value          = '';
  const rEnt = document.getElementById('r-entregado'); if (rEnt) rEnt.value = '';
  calcLive();
}

/** Crea un input dinámico de ingreso extra */
function addIngreso() {
  const c = document.createElement('div');
  c.className = 'dynamic-item with-label';
  c.innerHTML = `
    <input type="text"   placeholder="Concepto" style="${inputStyle()}" oninput="calcLive()">
    <input type="number" placeholder="Monto" min="0" step="0.01" style="${inputStyle()}" oninput="calcLive()">
    <button class="remove-item-btn" onclick="this.parentElement.remove();calcLive()">✕</button>`;
  document.getElementById('ingresos-extra').appendChild(c);
}

/** Crea un input dinámico de gasto */
function addGasto(concepto) {
  const c = document.createElement('div');
  c.className = 'dynamic-item with-label';
  c.innerHTML = `
    <input type="text"   value="${concepto}" placeholder="Concepto" style="${inputStyle()}" oninput="calcLive()">
    <input type="number" placeholder="Monto" min="0" step="0.01" style="${inputStyle()}" oninput="calcLive()">
    <button class="remove-item-btn" onclick="this.parentElement.remove();calcLive()">✕</button>`;
  document.getElementById('gastos-list').appendChild(c);
}

/** Estilo inline compartido para inputs dinámicos */
function inputStyle() {
  return 'padding:.65rem .9rem;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-family:var(--font-body);font-size:.88rem;width:100%';
}

/** Cálculo en vivo de totales */
function calcLive() {
  const flete = parseFloat(document.getElementById('r-flete').value) || 0;
  let ingresos = flete;
  document.querySelectorAll('#ingresos-extra .dynamic-item').forEach(row => {
    const inp = row.querySelectorAll('input[type=number]');
    if (inp.length) ingresos += parseFloat(inp[0].value) || 0;
  });
  let gastos = 0;
  gastos += parseFloat(document.getElementById('g-diesel')?.value) || 0;
  gastos += parseFloat(document.getElementById('g-pago-chofer')?.value) || 0;
  document.querySelectorAll('#gastos-list .dynamic-item').forEach(row => {
    const inp = row.querySelectorAll('input[type=number]');
    if (inp.length) gastos += parseFloat(inp[0].value) || 0;
  });

  const utilidad = ingresos - gastos;
  document.getElementById('calc-ingresos').textContent = fmt(ingresos);
  document.getElementById('calc-gastos').textContent   = fmt(gastos);
  const uEl = document.getElementById('calc-utilidad');
  uEl.textContent = fmt(utilidad);
  uEl.className   = utilidad >= 0 ? 'positive' : 'negative';
}

function resetForm() {
  const viajeId = window._viajeAgendaIdPendiente;
  window._viajeAgendaIdPendiente = null;

  if (viajeId) {
    // Venía de finalizar un viaje: solo limpiar campos editables por el chofer
    const diesel = document.getElementById('g-diesel');       if (diesel) diesel.value = '';
    const entregado = document.getElementById('r-entregado'); if (entregado) entregado.value = '';
    document.getElementById('gastos-list').innerHTML = '';
    // Desbloquear campos que se bloquearon
    ['r-fecha','r-cliente','r-destino','r-flete','g-pago-chofer'].forEach(fid => {
      const el = document.getElementById(fid); if (el) el.readOnly = false;
    });
    const uSel = document.getElementById('r-unidad'); if (uSel) uSel.disabled = false;
    const cSel = document.getElementById('r-chofer'); if (cSel) cSel.disabled = false;
    // Restaurar botón guardar
    const btn = document.querySelector('button[onclick="saveReporte()"]');
    if (btn) {
      btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar Reporte';
      btn.style.background = '';
      btn.style.border = '';
    }
    calcLive();
  } else {
    // Limpiar completo (uso normal por admin o chofer sin viaje asignado)
    ['r-fecha','r-cliente','r-destino','r-flete','g-pago-chofer'].forEach(fid => {
      const el = document.getElementById(fid); if (el) el.readOnly = false;
    });
    const uSel = document.getElementById('r-unidad'); if (uSel) uSel.disabled = false;
    const cSel = document.getElementById('r-chofer'); if (cSel) cSel.disabled = false;
    const btn = document.querySelector('button[onclick="saveReporte()"]');
    if (btn) {
      btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar Reporte';
      btn.style.background = '';
      btn.style.border = '';
    }
    initForm();
  }
}

async function saveReporte() {
  const sesion   = DB.sesion;
  const fecha    = document.getElementById('r-fecha').value;
  const chorerId = document.getElementById('r-chofer').value;
  const unidadId = document.getElementById('r-unidad').value;
  const cliente  = document.getElementById('r-cliente').value.trim();
  const destino    = document.getElementById('r-destino').value.trim();
  const entregadoA = document.getElementById('r-entregado').value.trim();
  const flete    = parseFloat(document.getElementById('r-flete').value) || 0;

  if (!fecha)       { toast('Selecciona la fecha del viaje', 'warning'); return; }
  if (!unidadId)    { toast('Selecciona una unidad', 'warning'); return; }
  if (!cliente)     { toast('Ingresa el cliente', 'warning'); return; }
  if (!destino)     { toast('Ingresa el destino', 'warning'); return; }

  if (!entregadoA)  { toast('Ingresa a quién se entregó la carga', 'warning'); return; }

  const chofer = DB.choferes.find(c => c.id === chorerId) || DB.choferes.find(c => c.id === sesion.id);
  const unidad = DB.unidades.find(u => u.id === unidadId);

  // Recopilar ingresos extra
  const ingresosExtra = [];
  document.querySelectorAll('#ingresos-extra .dynamic-item').forEach(row => {
    const ins     = row.querySelectorAll('input');
    const concepto = ins[0]?.value?.trim();
    const monto    = parseFloat(ins[1]?.value) || 0;
    if (concepto && monto > 0) ingresosExtra.push({ concepto, monto });
  });

  // Recopilar gastos (campos fijos + dinámicos)
  const gastos = [];
  const _diesel     = parseFloat(document.getElementById('g-diesel')?.value) || 0;
  const _pagoChofer = parseFloat(document.getElementById('g-pago-chofer')?.value) || 0;
  if (_diesel > 0)     gastos.push({ concepto: 'Diesel',          monto: _diesel });
  if (_pagoChofer > 0) gastos.push({ concepto: 'Pago de chófer',  monto: _pagoChofer });
  document.querySelectorAll('#gastos-list .dynamic-item').forEach(row => {
    const ins      = row.querySelectorAll('input');
    const concepto = ins[0]?.value?.trim();
    const monto    = parseFloat(ins[1]?.value) || 0;
    if (concepto && monto > 0) gastos.push({ concepto, monto });
  });

  const subtotalIngresos = flete + ingresosExtra.reduce((s, i) => s + i.monto, 0);
  const subtotalGastos   = gastos.reduce((s, g) => s + g.monto, 0);
  const utilidad         = subtotalIngresos - subtotalGastos;

  const reporte = {
    id: uid(),
    fecha,
    chorerId:     chofer?.id,
    choferNombre: chofer?.nombre || 'N/D',
    unidadId:     unidad?.id,
    unidadPlaca:  unidad?.placa   || 'N/D',
    unidadModelo: unidad?.modelo  || '',
    cliente,
    destino,
    entregadoA,
    flete,
    ingresosExtra,
    gastos,
    subtotalIngresos,
    subtotalGastos,
    utilidad,
    creadoEn: new Date().toISOString(),
  };

  try {
    await fsSet('reportes', reporte.id, reporte);
    // Si hay un viaje agendado vinculado, marcarlo como completado
    if (window._viajeAgendaIdPendiente) {
      const horaFin = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
      const viajeCompleto = DB.agenda.find(v => v.id === window._viajeAgendaIdPendiente);
      await _actualizarEstadoViajeExtra(window._viajeAgendaIdPendiente, 'completado', { horaFin });
      window._viajeAgendaIdPendiente = null;
      toast('Viaje finalizado y reporte guardado ✓', 'success');
      resetForm();
      navigate('dashboard');  // volver al dashboard para que vea la tarjeta desaparecer
    } else {
      toast('Reporte guardado correctamente ✓', 'success');
      resetForm();
      navigate('historial');
    }
  } catch(e) {
    console.error(e);
    toast('Error al guardar. Verifica tu conexión.', 'error');
  }
}

// ══════════════════════════════════════════════
//  HISTORIAL
// ══════════════════════════════════════════════
function renderHistorial() {
  const sesion = DB.sesion;
  let reportes = DB.reportes;
  if (sesion.rol === 'chofer') reportes = reportes.filter(r => r.chorerId === sesion.id);

  // Poblar filtros preservando selección actual
  const fu   = document.getElementById('f-unidad');
  const fc   = document.getElementById('f-chofer');
  const prevU = fu.value, prevC = fc.value;
  fu.innerHTML = '<option value="">Todas las unidades</option>' +
    DB.unidades.map(u => `<option value="${u.id}">${u.modelo} (${u.placa})</option>`).join('');
  fc.innerHTML = '<option value="">Todos los choferes</option>' +
    DB.choferes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  fu.value = prevU; fc.value = prevC;

  // Aplicar filtros
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;

  const filtrados = reportes.filter(r => {
    if (desde && r.fecha < desde)    return false;
    if (hasta && r.fecha > hasta)    return false;
    if (fu.value && r.unidadId !== fu.value) return false;
    if (fc.value && r.chorerId !== fc.value) return false;
    return true;
  }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const tbody = document.getElementById('historial-tbody');

  if (!filtrados.length) {
    tbody.innerHTML = '<div class="empty-state" style="padding:2rem 0"><p>Sin registros encontrados.</p></div>';
    return;
  }

  tbody.innerHTML = filtrados.map(r => {
    const pos = r.utilidad >= 0;
    return `
    <div class="activity-item" style="cursor:default">
      <div class="activity-badge" style="background:${pos ? 'var(--success)' : 'var(--danger)'}"></div>
      <div class="activity-info" style="flex:1;min-width:0">
        <strong>${r.cliente || 'Sin cliente'} — ${r.destino || ''}</strong>
        <span>${fmtDate(r.fecha)} · ${r.unidadModelo || r.unidadPlaca} · ${r.choferNombre}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.35rem;flex-shrink:0">
        <span class="activity-amount ${pos ? 'positive' : 'negative'}">${fmt(r.utilidad)}</span>
        <div style="display:flex;gap:.35rem">
          <button class="btn btn-secondary btn-sm" onclick="showDetalle('${r.id}')">Ver</button>
          ${sesion.rol !== 'chofer' ? `<button class="btn btn-danger btn-sm" onclick="confirmDelete('${r.id}')">✕</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function clearFilters() {
  document.getElementById('f-desde').value  = '';
  document.getElementById('f-hasta').value  = '';
  document.getElementById('f-unidad').value = '';
  document.getElementById('f-chofer').value = '';
  renderHistorial();
}

function confirmDelete(id) {
  openModal('modal-confirm');
  document.getElementById('confirm-msg').textContent =
    '¿Estás seguro de que deseas eliminar este reporte? Esta acción no se puede deshacer.';
  document.getElementById('confirm-ok-btn').onclick = async () => {
    try {
      await fsDelete('reportes', id);
      closeModal('modal-confirm');
      toast('Reporte eliminado', 'info');
    } catch(e) {
      toast('Error al eliminar', 'error');
    }
  };
}

// ══════════════════════════════════════════════
//  MODAL DETALLE
// ══════════════════════════════════════════════
function showDetalle(id) {
  const r = DB.reportes.find(x => x.id === id);
  if (!r) return;

  const ingrosExtra = r.ingresosExtra || [];
  const gastos      = r.gastos       || [];

  document.getElementById('modal-detalle-body').innerHTML = `
    <div class="detail-row"><span>Fecha</span><span>${fmtDate(r.fecha)}</span></div>
    <div class="detail-row"><span>Cliente</span><span>${r.cliente}</span></div>
    <div class="detail-row"><span>Destino</span><span>${r.destino || '—'}</span></div>
    <div class="detail-row"><span>Entregado a</span><span>${r.entregadoA || '—'}</span></div>
    <div class="detail-row"><span>Unidad</span><span>${r.unidadPlaca} — ${r.unidadModelo}</span></div>
    <div class="detail-row"><span>Chofer</span><span>${r.choferNombre}</span></div>

    <div class="detail-section-title">Ingresos</div>
    <div class="detail-row"><span>Precio de viaje</span><span class="positive">${fmt(r.flete)}</span></div>
    ${ingrosExtra.map(i => `<div class="detail-row"><span>${i.concepto}</span><span class="positive">${fmt(i.monto)}</span></div>`).join('')}
    <div class="detail-row" style="border-top:1px solid var(--border-accent)">
      <span><strong>Subtotal Ingresos</strong></span>
      <span class="positive"><strong>${fmt(r.subtotalIngresos)}</strong></span>
    </div>

    <div class="detail-section-title">Gastos</div>
    ${gastos.length
      ? gastos.map(g => `<div class="detail-row"><span>${g.concepto}</span><span class="negative">${fmt(g.monto)}</span></div>`).join('')
      : '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">Sin gastos registrados</div>'}
    <div class="detail-row" style="border-top:1px solid var(--border-accent)">
      <span><strong>Subtotal Gastos</strong></span>
      <span class="negative"><strong>${fmt(r.subtotalGastos)}</strong></span>
    </div>

    <div class="detail-row" style="border-top:2px solid var(--accent);margin-top:.5rem;padding-top:.75rem">
      <span style="font-size:1rem"><strong>UTILIDAD NETA</strong></span>
      <span style="font-family:var(--font-title);font-size:1.4rem" class="${r.utilidad >= 0 ? 'positive' : 'negative'}">
        <strong>${fmt(r.utilidad)}</strong>
      </span>
    </div>`;

  document.getElementById('modal-share-btn').onclick = () => shareWhatsApp(id);
  const editBtn = document.getElementById('modal-edit-btn');
  if (DB.sesion.rol === 'chofer') {
    editBtn.style.display = 'none';
  } else {
    editBtn.style.display = '';
    editBtn.onclick = () => openEditReporte(id);
  }
  openModal('modal-detalle');
}

// ══════════════════════════════════════════════
//  ADMINISTRACIÓN
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
//  AGENDA DE VIAJES
// ══════════════════════════════════════════════

function _buildAgendaCard(v) {
  const estadoBadge = {
    'sin-chofer': 'Sin Asignar', pendiente: 'Pendiente',
    aceptado: 'Aceptado', 'en-ruta': 'En Ruta', completado: 'Completado'
  };
  const chofer = DB.choferes.find(c => c.id === v.chorerId);
  const unidad = DB.unidades.find(u => u.id === v.unidadId);
  const estado = !v.chorerId ? 'sin-chofer' : (v.estado || 'pendiente');
  const btnAsignar = !v.chorerId
    ? `<button class="btn btn-primary btn-sm" onclick="openAsignarChofer('${v.id}')">
         <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
         Asignar Chofer
       </button>`
    : '';
  return `
  <div class="agenda-card">
    <div class="agenda-card-header">
      <div class="agenda-card-title">${v.cliente} → ${v.destino}</div>
      <span class="agenda-badge ${estado}">${estadoBadge[estado] || estado}</span>
    </div>
    <div class="agenda-card-info">
      <div class="agenda-info-item"><label>Fecha</label><span>${fmtDate(v.fecha)}</span></div>
      <div class="agenda-info-item"><label>Hora salida</label><span>${fmtHora(v.hora)}</span></div>
      ${v.horaInicio ? `<div class="agenda-info-item"><label>Inicio real</label><span style="color:#57D5D5;font-weight:600">${v.horaInicio}</span></div>` : ''}
      ${v.horaFin    ? `<div class="agenda-info-item"><label>Finalizado</label><span style="color:#36B25F;font-weight:600">${v.horaFin}</span></div>` : ''}
      <div class="agenda-info-item"><label>Chofer</label><span>${chofer ? chofer.nombre : '⚠ Sin asignar'}</span></div>
      <div class="agenda-info-item"><label>Unidad</label><span>${unidad ? unidad.modelo + ' (' + unidad.placa + ')' : '—'}</span></div>
      <div class="agenda-info-item"><label>Precio</label><span style="color:var(--success)">${fmt(v.flete)}</span></div>
    </div>
    <div class="agenda-card-actions">
      ${btnAsignar}
      ${(estado === 'pendiente' || estado === 'sin-chofer' || estado === 'aceptado') ? `
      <button class="btn btn-secondary btn-sm" onclick="openEditViajeAgenda('${v.id}')">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Editar
      </button>` : ''}
      <button class="btn btn-danger btn-sm" onclick="deleteViajeAgenda('${v.id}')">Eliminar</button>
    </div>
  </div>`;
}

function _renderAgendaSection(containerId, viajes, titulo, accentStyle) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!viajes.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="margin-bottom:.75rem">
      <span style="font-family:var(--font-title);font-size:1.1rem;letter-spacing:1.5px;${accentStyle}">${titulo}</span>
      <span style="font-size:.78rem;color:var(--text-muted);margin-left:.6rem">${viajes.length} viaje${viajes.length !== 1 ? 's' : ''}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:1rem">
      ${viajes.map(_buildAgendaCard).join('')}
    </div>`;
}

function renderAgenda() {
  if (!document.getElementById('agenda-sec-hoy')) return;

  const todos   = DB.agenda;
  const hoy     = localDateStr(0);
  const manana  = localDateStr(1);

  // Activos: no completados. Los en-ruta SIEMPRE son activos sin importar fecha
  const activos = todos.filter(v => v.estado !== 'completado');

  const enRutaFueraDeFecha = activos.filter(v => v.estado === 'en-ruta' && v.fecha !== hoy && v.fecha !== manana);
  const deHoy    = activos.filter(v => v.fecha === hoy).sort((a,b)    => (a.hora||'').localeCompare(b.hora||''));
  const deManana = activos.filter(v => v.fecha === manana).sort((a,b) => (a.hora||'').localeCompare(b.hora||''));
  // Próximos: excluir completados, excluir en-ruta que ya fueron separados, excluir hoy y mañana
  const resto    = activos.filter(v => v.fecha !== hoy && v.fecha !== manana && v.estado !== 'en-ruta')
                          .sort((a,b) => a.fecha.localeCompare(b.fecha));

  // Sección especial: en ruta fuera de fecha (pasados o sin fecha de hoy)
  const secEnRuta = document.getElementById('agenda-sec-en-ruta');
  if (secEnRuta) {
    if (enRutaFueraDeFecha.length) {
      secEnRuta.innerHTML = `
        <div style="margin-bottom:.75rem">
          <span style="font-family:var(--font-title);font-size:1.1rem;letter-spacing:1.5px;color:#9D5DD9">EN RUTA</span>
          <span style="font-size:.78rem;color:var(--text-muted);margin-left:.6rem">${enRutaFueraDeFecha.length} viaje${enRutaFueraDeFecha.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:1rem">
          ${enRutaFueraDeFecha.map(_buildAgendaCard).join('')}
        </div>`;
    } else {
      secEnRuta.innerHTML = '';
    }
  }

  if (!activos.length) {
    document.getElementById('agenda-sec-hoy').innerHTML = '<div class="empty-state"><p>Sin viajes agendados.</p></div>';
    document.getElementById('agenda-sec-manana').innerHTML = '';
    document.getElementById('agenda-sec-resto').innerHTML = '';
    return;
  }

  _renderAgendaSection('agenda-sec-hoy',    deHoy,    'VIAJES PARA HOY',    'color:#762FA4');
  _renderAgendaSection('agenda-sec-manana', deManana, 'VIAJES PARA MAÑANA', 'color:#57D5D5');
  _renderAgendaSection('agenda-sec-resto',  resto,    'PRÓXIMOS VIAJES',    'color:var(--text-muted)');

  if (!deHoy.length && !enRutaFueraDeFecha.length) {
    document.getElementById('agenda-sec-hoy').innerHTML =
      `<div style="margin-bottom:.75rem"><span style="font-family:var(--font-title);font-size:1.1rem;letter-spacing:1.5px;color:#762FA4">VIAJES PARA HOY</span></div>
       <div class="empty-state" style="padding:1rem 0"><p>Sin viajes programados para hoy.</p></div>`;
  }
}

function renderAgendaFinalizados() {
  const completados = DB.agenda.filter(v => v.estado === 'completado')
                               .sort((a,b) => b.fecha.localeCompare(a.fecha));
  const el = document.getElementById('agenda-finalizados-list');
  if (!el) return;
  if (!completados.length) {
    el.innerHTML = '<div class="empty-state"><p>Sin viajes finalizados.</p></div>';
    return;
  }
  el.innerHTML = completados.map(v => {
    const chofer = DB.choferes.find(c => c.id === v.chorerId);
    const unidad = DB.unidades.find(u => u.id === v.unidadId);
    return `
    <div class="activity-item" style="cursor:default">
      <div class="activity-badge" style="background:var(--success)"></div>
      <div class="activity-info" style="flex:1;min-width:0">
        <strong>${v.cliente || '—'} — ${v.destino || ''}</strong>
        <span>${fmtDate(v.fecha)}${v.hora ? ' · ' + fmtHora(v.hora) : ''}${chofer ? ' · ' + chofer.nombre : ''}${unidad ? ' · ' + unidad.modelo : ''}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.2rem;flex-shrink:0">
        <span style="font-size:.7rem;color:var(--success);font-weight:600">Completado</span>
      </div>
    </div>`;
  }).join('');
}

function openModalAgenda() {
  // Poblar selects de chofer y unidad
  const choferes = DB.choferes.filter(c => c.id !== 'c0');
  document.getElementById('av-chofer').innerHTML =
    '<option value="">Sin asignar</option>' +
    choferes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  document.getElementById('av-unidad').innerHTML =
    '<option value="">Sin asignar</option>' +
    DB.unidades.map(u => `<option value="${u.id}">${u.modelo} (${u.placa})</option>`).join('');
  // Fecha por defecto hoy
  document.getElementById('av-fecha').value = localDateStr();
  openModal('modal-nuevo-viaje-agenda');
}

async function saveViajeAgenda() {
  const fecha    = document.getElementById('av-fecha').value;
  const hora     = document.getElementById('av-hora').value;
  const cliente  = document.getElementById('av-cliente').value.trim();
  const origen   = document.getElementById('av-origen').value.trim();
  const destino  = document.getElementById('av-destino').value.trim();
  const flete    = parseFloat(document.getElementById('av-flete').value) || 0;
  const chorerId = document.getElementById('av-chofer').value;
  const unidadId = document.getElementById('av-unidad').value;

  if (!fecha || !cliente || !destino) {
    toast('Completa fecha, cliente y destino', 'warning'); return;
  }

  const pagoChofer = parseFloat(document.getElementById('av-pago-chofer').value) || 0;
  const estado = chorerId ? 'pendiente' : 'sin-chofer';
  const indicaciones = document.getElementById('av-indicaciones').value.trim();
  const viaje = { id: uid(), fecha, hora, cliente, origen, destino, flete, pagoChofer, indicaciones, chorerId, unidadId, estado, creadoEn: new Date().toISOString() };

  try {
    await fsSet('agenda', viaje.id, viaje);
    // Limpiar
    ['av-fecha','av-hora','av-cliente','av-origen','av-destino','av-flete','av-pago-chofer'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('av-indicaciones').value = '';
    document.getElementById('av-chofer').value = '';
    document.getElementById('av-unidad').value = '';
    closeModal('modal-nuevo-viaje-agenda');
    toast('Viaje agendado correctamente', 'success');
  } catch(e) { console.error(e); toast('Error al agendar', 'error'); }
}

function openEditViajeAgenda(id) {
  const v = DB.agenda.find(x => x.id === id);
  if (!v) return;
  // Poblar selects
  const choferes = DB.choferes.filter(c => c.id !== 'c0');
  document.getElementById('ea-chofer').innerHTML =
    '<option value="">Sin asignar</option>' +
    choferes.map(c => `<option value="${c.id}"${v.chorerId === c.id ? ' selected' : ''}>${c.nombre}</option>`).join('');
  document.getElementById('ea-unidad').innerHTML =
    '<option value="">Sin asignar</option>' +
    DB.unidades.map(u => `<option value="${u.id}"${v.unidadId === u.id ? ' selected' : ''}>${u.modelo} (${u.placa})</option>`).join('');
  // Precargar datos
  document.getElementById('ea-id').value      = v.id;
  document.getElementById('ea-fecha').value   = v.fecha  || '';
  document.getElementById('ea-hora').value    = v.hora   || '';
  document.getElementById('ea-cliente').value = v.cliente || '';
  document.getElementById('ea-origen').value  = v.origen  || '';
  document.getElementById('ea-destino').value = v.destino || '';
  document.getElementById('ea-flete').value        = v.flete      || '';
  document.getElementById('ea-pago-chofer').value   = v.pagoChofer   || '';
  document.getElementById('ea-indicaciones').value  = v.indicaciones || '';
  openModal('modal-edit-viaje-agenda');
}

async function saveEditViajeAgenda() {
  const id       = document.getElementById('ea-id').value;
  const fecha    = document.getElementById('ea-fecha').value;
  const hora     = document.getElementById('ea-hora').value;
  const cliente  = document.getElementById('ea-cliente').value.trim();
  const origen   = document.getElementById('ea-origen').value.trim();
  const destino  = document.getElementById('ea-destino').value.trim();
  const flete      = parseFloat(document.getElementById('ea-flete').value) || 0;
  const pagoChofer = parseFloat(document.getElementById('ea-pago-chofer').value) || 0;
  const chorerId   = document.getElementById('ea-chofer').value;
  const unidadId   = document.getElementById('ea-unidad').value;

  if (!fecha || !cliente || !destino) {
    toast('Completa fecha, cliente y destino', 'warning'); return;
  }

  const agenda = [...DB.agenda];
  const idx = agenda.findIndex(v => v.id === id);
  if (idx === -1) { toast('Viaje no encontrado', 'error'); return; }

  const indicaciones = document.getElementById('ea-indicaciones').value.trim();
  agenda[idx] = { ...agenda[idx], fecha, hora, cliente, origen, destino, flete, pagoChofer, indicaciones, chorerId, unidadId };

  try {
    await fsSet('agenda', id, agenda[idx]);
    _cache.agenda = agenda;
    closeModal('modal-edit-viaje-agenda');
    toast('Viaje actualizado correctamente', 'success');
    renderAgenda();
  } catch(e) { console.error(e); toast('Error al guardar', 'error'); }
}

function openAsignarChofer(id) {
  const v = DB.agenda.find(x => x.id === id);
  if (!v) return;
  const choferes = DB.choferes.filter(c => c.id !== 'c0');
  document.getElementById('ac-chofer').innerHTML =
    '<option value="">Selecciona un chofer...</option>' +
    choferes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  document.getElementById('ac-unidad').innerHTML =
    '<option value="">Sin asignar</option>' +
    DB.unidades.map(u => `<option value="${u.id}">${u.modelo} (${u.placa})</option>`).join('');
  document.getElementById('ac-id').value = id;
  openModal('modal-asignar-chofer');
}

async function saveAsignarChofer() {
  const id       = document.getElementById('ac-id').value;
  const chorerId = document.getElementById('ac-chofer').value;
  const unidadId = document.getElementById('ac-unidad').value;

  if (!chorerId) { toast('Selecciona un chofer', 'warning'); return; }

  const agenda = [...DB.agenda];
  const idx = agenda.findIndex(v => v.id === id);
  if (idx === -1) { toast('Viaje no encontrado', 'error'); return; }

  agenda[idx] = { ...agenda[idx], chorerId, unidadId, estado: 'pendiente' };

  try {
    await fsSet('agenda', id, agenda[idx]);
    _cache.agenda = agenda;
    closeModal('modal-asignar-chofer');
    toast('Chofer asignado correctamente', 'success');
    renderAgenda();
  } catch(e) { console.error(e); toast('Error al asignar', 'error'); }
}

function deleteViajeAgenda(id) {
  openModal('modal-confirm');
  document.getElementById('confirm-msg').textContent = '¿Eliminar este viaje agendado?';
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeModal('modal-confirm');
    try {
      await fsDelete('agenda', id);
      _cache.agenda = _cache.agenda.filter(v => v.id !== id);
      toast('Viaje eliminado', 'info');
      renderAgenda();
    } catch(e) { toast('Error al eliminar', 'error'); }
  };
}

async function choferAceptarViaje(id) {
  await _actualizarEstadoViaje(id, 'aceptado');
  toast('¡Viaje aceptado!', 'success');
}

function choferIniciarViaje(id) {
  const viaje = DB.agenda.find(v => v.id === id);
  if (!viaje) return;
  // Modal de confirmación
  openModal('modal-confirm');
  document.getElementById('confirm-msg').textContent =
    `¿Confirmas que inicias el viaje a ${viaje.destino}${viaje.cliente ? ' para ' + viaje.cliente : ''}?`;
  const btn = document.getElementById('confirm-ok-btn');
  btn.textContent  = 'Iniciar Viaje';
  btn.className    = 'btn btn-primary';
  btn.onclick = async () => {
    closeModal('modal-confirm');
    btn.textContent = 'Eliminar';
    btn.className   = 'btn btn-danger';
    const horaInicio = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
    await _actualizarEstadoViajeExtra(id, 'en-ruta', { horaInicio });
    toast('¡Viaje iniciado! En ruta.', 'info');
  };
}

async function choferFinalizarViaje(id) {
  const viaje = DB.agenda.find(v => v.id === id);
  if (!viaje) return;
  // Guardar id para marcar completado al guardar el reporte
  window._viajeAgendaIdPendiente = id;
  navigate('nuevo-reporte');
  setTimeout(() => {
    const g = (sel) => document.getElementById(sel);
    // Precargar datos del viaje
    if (g('r-fecha'))   g('r-fecha').value   = viaje.fecha || localDateStr();
    if (g('r-cliente')) g('r-cliente').value = viaje.cliente || '';
    if (g('r-destino')) g('r-destino').value = viaje.destino || '';
    if (g('r-flete'))   { g('r-flete').value = viaje.flete || ''; calcLive(); }
    if (viaje.pagoChofer && g('g-pago-chofer')) { g('g-pago-chofer').value = viaje.pagoChofer; calcLive(); }
    if (viaje.chorerId && g('r-chofer')) g('r-chofer').value = viaje.chorerId;
    if (viaje.unidadId && g('r-unidad')) g('r-unidad').value = viaje.unidadId;
    // Bloquear campos para que el chofer no los modifique
    ['r-fecha','r-cliente','r-destino','r-flete'].forEach(fid => {
      const el = g(fid); if (el) el.readOnly = true;
    });
    if (g('r-unidad'))     g('r-unidad').disabled = true;
    if (g('r-chofer'))     g('r-chofer').disabled = true;
    if (g('g-pago-chofer')) g('g-pago-chofer').readOnly = true;
    // Cambiar botón a "Finalizar Viaje"
    const btn = document.querySelector('button[onclick="saveReporte()"]');
    if (btn) {
      btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Finalizar Viaje';
      btn.style.background = 'linear-gradient(135deg,#36B25F,#57D5D5)';
      btn.style.border = 'none';
    }
  }, 300);
}

function reabrirReportePendiente(id) {
  const viaje = DB.agenda.find(v => v.id === id);
  if (!viaje) return;
  window._viajeAgendaIdPendiente = id;
  navigate('nuevo-reporte');
  setTimeout(() => {
    const el = (sel) => document.getElementById(sel);
    if (el('r-fecha'))   el('r-fecha').value   = viaje.fecha || localDateStr();
    if (el('r-cliente')) el('r-cliente').value  = viaje.cliente || '';
    if (el('r-destino')) el('r-destino').value  = viaje.destino || '';
    if (el('r-flete'))   { el('r-flete').value  = viaje.flete || ''; calcLive(); }
    if (viaje.chorerId && el('r-chofer')) el('r-chofer').value = viaje.chorerId;
    if (viaje.unidadId && el('r-unidad')) el('r-unidad').value = viaje.unidadId;
  }, 300);
}

async function _actualizarEstadoViaje(id, estado) {
  return _actualizarEstadoViajeExtra(id, estado, {});
}

async function _actualizarEstadoViajeExtra(id, estado, extra) {
  const agenda = [...DB.agenda];
  const idx = agenda.findIndex(v => v.id === id);
  if (idx === -1) return;
  agenda[idx] = { ...agenda[idx], estado, ...extra };
  // Actualizar cache LOCAL de inmediato para que la UI refleje el cambio sin esperar Firestore
  _cache.agenda = agenda;
  // Refrescar contenedor de tarjetas del chofer si está visible
  const sesion = DB.sesion;
  const container = document.getElementById('viajes-asignados-container');
  if (container && sesion) container.innerHTML = renderViajesChofer(sesion);
  // Persistir en Firestore
  await fsSet('agenda', id, agenda[idx]);
}


function renderViajesChofer(sesion) {
  // Retorna HTML de tarjetas de viajes asignados al chofer
  // Comparación estricta como string para evitar problemas de tipo
  const sid = String(sesion.id);
  const viajes = DB.agenda.filter(v => String(v.chorerId) === sid && v.estado !== 'completado');
  // La tarjeta permanece visible mientras no se guarde el reporte (estado en-ruta)
  if (!viajes.length) return '';

  const estadoLabel = { pendiente: 'Viaje Asignado', aceptado: 'Viaje Aceptado', 'en-ruta': 'En Ruta' };

  return viajes.map(v => {
    const unidad = DB.unidades.find(u => u.id === v.unidadId);
    const estado = v.estado || 'pendiente';
    let acciones = '';
    if (estado === 'pendiente') {
      acciones = `<button class="btn btn-primary" style="width:100%" onclick="choferAceptarViaje('${v.id}')">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        Aceptar Viaje
      </button>`;
    } else if (estado === 'aceptado') {
      acciones = `<button class="btn btn-primary" style="width:100%;background:linear-gradient(135deg,#57D5D5,#36B25F)" onclick="choferIniciarViaje('${v.id}')">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Iniciar Viaje
      </button>`;
    } else if (estado === 'en-ruta') {
      acciones = `<button class="btn btn-danger" style="width:100%" onclick="choferFinalizarViaje('${v.id}')">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        Finalizar Viaje
      </button>`;
    }
    return `
    <div class="viaje-asignado-card">
      <h3>
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        ${estadoLabel[estado] || 'Viaje'}
      </h3>
      <div class="agenda-card-info" style="margin-bottom:.85rem">
        <div class="agenda-info-item"><label>Fecha</label><span>${fmtDate(v.fecha)}</span></div>
        <div class="agenda-info-item"><label>Hora</label><span>${fmtHora(v.hora)}</span></div>
        <div class="agenda-info-item"><label>Cliente</label><span>${v.cliente}</span></div>
        ${v.origen ? `<div class="agenda-info-item"><label>Origen</label><span>${v.origen}</span></div>` : ''}
        <div class="agenda-info-item"><label>Destino</label><span>${v.destino}</span></div>
        <div class="agenda-info-item"><label>Precio</label><span style="color:var(--success)">${fmt(v.flete)}</span></div>
        ${unidad ? `<div class="agenda-info-item"><label>Unidad</label><span>${unidad.modelo}</span></div>` : ''}
      </div>
      ${v.indicaciones ? `<div style="background:rgba(255,193,7,.08);border:1px solid rgba(255,193,7,.3);border-radius:var(--radius-sm);padding:.65rem .85rem;font-size:.82rem;color:var(--text-primary);margin-bottom:.85rem">
        <span style="font-weight:700;font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;color:#f59e0b">📋 Indicaciones</span><br>${v.indicaciones}
      </div>` : ''}
      ${acciones}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  ESTADÍSTICAS
// ══════════════════════════════════════════════
const _charts = {};

function _destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function _makeChart(id, config) {
  _destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  _charts[id] = new Chart(canvas.getContext('2d'), config);
}

function _chartCard(title, canvasId) {
  return `<div class="card" style="padding:1.25rem">
    <div style="font-family:var(--font-title);font-size:.95rem;letter-spacing:1.5px;color:var(--text-secondary);margin-bottom:1rem">${title}</div>
    <div style="position:relative;height:220px"><canvas id="${canvasId}"></canvas></div>
  </div>`;
}

function renderStats() {
  const container = document.getElementById('stats-container');
  if (!container) return;

  const sesion  = DB.sesion;
  const esAdmin = sesion.rol === 'admin';
  const ahora   = new Date();

  // Poblar selectores año y mes
  const selAnio = document.getElementById('stats-anio');
  const selMes  = document.getElementById('stats-mes');
  const anioActual = ahora.getFullYear();

  if (selAnio.options.length === 0) {
    for (let y = anioActual; y >= anioActual - 3; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      selAnio.appendChild(o);
    }
    selAnio.value = anioActual;
  }
  if (selMes.options.length === 0) {
    const mesesN = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    mesesN.forEach((m,i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = m;
      selMes.appendChild(o);
    });
    selMes.value = ahora.getMonth();
  }

  const anioSel  = parseInt(selAnio.value);
  const mesSel   = parseInt(selMes.value);
  const diasEnMes = new Date(anioSel, mesSel + 1, 0).getDate();
  const meses    = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  let reportes = DB.reportes;
  if (!esAdmin) reportes = reportes.filter(r => r.chorerId === sesion.id);

  const reportesMes = reportes.filter(r => {
    if (!r.fecha) return false;
    const [y, m] = r.fecha.split('-').map(Number);
    return y === anioSel && (m - 1) === mesSel;
  });

  const reportesAnio = reportes.filter(r => {
    if (!r.fecha) return false;
    return parseInt(r.fecha.split('-')[0]) === anioSel;
  });

  const dailyLabels = Array.from({length: diasEnMes}, (_, i) => String(i + 1));

  let dailyData, dailyLabel, dailyColors;
  if (esAdmin) {
    dailyData = dailyLabels.map(d => {
      const dia = String(d).padStart(2,'0');
      const fecha = `${anioSel}-${String(mesSel+1).padStart(2,'0')}-${dia}`;
      return reportesMes.filter(r => r.fecha === fecha).reduce((s, r) => s + r.utilidad, 0);
    });
    dailyLabel  = 'Utilidad Neta Diaria';
    dailyColors = dailyData.map(v => v >= 0 ? 'rgba(54,178,95,.75)' : 'rgba(239,68,68,.75)');
  } else {
    dailyData = dailyLabels.map(d => {
      const dia = String(d).padStart(2,'0');
      const fecha = `${anioSel}-${String(mesSel+1).padStart(2,'0')}-${dia}`;
      return reportesMes.filter(r => r.fecha === fecha).reduce((s, r) => {
        const g = (r.gastos||[]).find(x => x.concepto && x.concepto.toLowerCase().includes('pago de ch'));
        return s + (g ? g.monto : 0);
      }, 0);
    });
    dailyLabel  = 'Pago de Chófer Diario';
    dailyColors = 'rgba(157,93,217,.75)';
  }

  let monthlyData, monthlyLabel;
  if (esAdmin) {
    monthlyData = meses.map((_, i) =>
      reportesAnio.filter(r => parseInt(r.fecha.split('-')[1]) - 1 === i)
                  .reduce((s, r) => s + r.utilidad, 0)
    );
    monthlyLabel = 'Utilidad Neta Mensual';
  } else {
    monthlyData = meses.map((_, i) =>
      reportesAnio.filter(r => parseInt(r.fecha.split('-')[1]) - 1 === i)
                  .reduce((s, r) => {
                    const g = (r.gastos||[]).find(x => x.concepto && x.concepto.toLowerCase().includes('pago de ch'));
                    return s + (g ? g.monto : 0);
                  }, 0)
    );
    monthlyLabel = 'Pago de Chófer Mensual';
  }
  const monthlyColors = monthlyData.map(v => v >= 0 ? 'rgba(87,213,213,.75)' : 'rgba(239,68,68,.75)');

  let choferHtml = '';
  if (esAdmin) {
    const choferes = DB.choferes.filter(c => c.id !== 'c0');
    const choferLabels = choferes.map(c => c.nombre);
    const choferData   = choferes.map(c =>
      reportesMes.filter(r => r.chorerId === c.id).reduce((s, r) => s + r.utilidad, 0)
    );
    const choferCardHeight = Math.max(180, choferes.length * 52);
    choferHtml = `<div class="card" style="padding:1.25rem">
      <div style="font-family:var(--font-title);font-size:.95rem;letter-spacing:1.5px;color:var(--text-secondary);margin-bottom:1rem">UTILIDAD POR CHOFER — ${meses[mesSel].toUpperCase()} ${anioSel}</div>
      <div style="position:relative;height:${choferCardHeight}px"><canvas id="chart-chofer"></canvas></div>
    </div>`;
    setTimeout(() => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const textColor = isDark ? '#b0b8c8' : '#555e6d';
      const gridColor = isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)';
      _makeChart('chart-chofer', {
        type: 'bar',
        data: {
          labels: choferLabels,
          datasets: [{ label: 'Utilidad', data: choferData,
            backgroundColor: choferData.map(v => v >= 0 ? 'rgba(54,178,95,.8)' : 'rgba(239,68,68,.8)'),
            borderRadius: 4, borderSkipped: false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: ctx => ' $' + Number(ctx.parsed.y||0).toLocaleString('es-MX',{minimumFractionDigits:2}) } } },
          scales: {
            x: { ticks: { color: textColor, font: { size: 11, weight: '600' } }, grid: { color: gridColor, lineWidth: 1 }, border: { color: isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)' } },
            y: { ticks: { color: textColor, font: { size: 10 }, callback: v => '$' + Number(v).toLocaleString('es-MX',{minimumFractionDigits:0}) }, grid: { color: gridColor, lineWidth: 1 }, border: { color: isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)' } }
          }
        }
      });
    }, 50);
  }

  const tituloMes  = esAdmin ? 'UTILIDAD NETA DIARIA — ' : 'PAGOS DIARIOS — ';
  const tituloAnio = esAdmin ? 'UTILIDAD NETA MENSUAL — ' : 'PAGOS MENSUALES — ';

  container.innerHTML =
    _chartCard(tituloMes  + meses[mesSel].toUpperCase() + ' ' + anioSel, 'chart-daily') +
    _chartCard(tituloAnio + anioSel, 'chart-monthly') +
    choferHtml;

  setTimeout(() => {
    _makeChart('chart-daily', {
      type: 'bar',
      data: { labels: dailyLabels, datasets: [{ label: dailyLabel, data: dailyData, backgroundColor: dailyColors, borderRadius: 4, borderSkipped: false }] },
      options: _chartOpts(false)
    });
    _makeChart('chart-monthly', {
      type: 'bar',
      data: { labels: meses, datasets: [{ label: monthlyLabel, data: monthlyData, backgroundColor: monthlyColors, borderRadius: 6, borderSkipped: false }] },
      options: _chartOpts(false)
    });
  }, 50);
}

function _chartOpts(indexAxis) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor  = isDark ? '#b0b8c8' : '#555e6d';
  const gridColor  = isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)';
  const borderColor = isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)';
  return {
    indexAxis: indexAxis ? 'y' : 'x',
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false },
      tooltip: { callbacks: { label: ctx => ' $' + Number(ctx.parsed[indexAxis ? 'x' : 'y'] || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 }) } } },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor, lineWidth: 1 }, border: { color: borderColor } },
      y: { ticks: { color: textColor, font: { size: 10 }, callback: v => '$' + Number(v).toLocaleString('es-MX', { minimumFractionDigits: 0 }) }, grid: { color: gridColor, lineWidth: 1 }, border: { color: borderColor } }
    }
  };
}

// ══════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════
function renderAdmin() {
  const choferes = DB.choferes;
  const unidades = DB.unidades;

  document.getElementById('choferes-list').innerHTML = choferes.length
    ? choferes.map(c => `
      <div class="admin-list-item">
        <div style="flex:1;min-width:0">
          <span>${c.nombre}</span>
          <div style="font-size:.72rem;color:var(--text-muted)">${c.username} · <span style="color:var(--accent)">${c.rol}</span></div>
        </div>
        ${c.id !== 'c0'
          ? `<button class="btn btn-secondary btn-sm" onclick="openEditChofer('${c.id}')" title="Editar rol">
               <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
             </button>
             <button class="btn btn-danger btn-sm" onclick="deleteChofer('${c.id}')">✕</button>`
          : '<span style="font-size:.72rem;color:var(--text-muted)">Admin principal</span>'}
      </div>`).join('')
    : '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:.75rem">Sin choferes</p>';

  document.getElementById('unidades-list').innerHTML = unidades.length
    ? unidades.map(u => `
      <div class="admin-list-item">
        <div style="flex:1;min-width:0">
          <span>${u.modelo}</span>
          <div style="font-size:.72rem;color:var(--text-muted)">${u.placa}</div>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-secondary btn-sm" onclick="openEditUnidad('${u.id}')" title="Editar unidad">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteUnidad('${u.id}')">✕</button>
        </div>
      </div>`).join('')
    : '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:.75rem">Sin unidades</p>';
}

function openEditChofer(id) {
  const c = DB.choferes.find(x => x.id === id);
  if (!c) return;
  document.getElementById('edit-chofer-id').value     = c.id;
  document.getElementById('edit-chofer-nombre').value = c.nombre;
  document.getElementById('edit-chofer-pass').value   = '';
  document.getElementById('edit-chofer-rol').value    = c.rol;
  openModal('modal-edit-chofer');
}

async function saveEditChofer() {
  const id     = document.getElementById('edit-chofer-id').value;
  const nombre = document.getElementById('edit-chofer-nombre').value.trim();
  const pass   = document.getElementById('edit-chofer-pass').value;
  const rol    = document.getElementById('edit-chofer-rol').value;
  if (!nombre) { toast('El nombre no puede estar vacío', 'warning'); return; }
  const choferes = [...DB.choferes];
  const idx = choferes.findIndex(c => c.id === id);
  if (idx === -1) { toast('Usuario no encontrado', 'error'); return; }
  choferes[idx] = { ...choferes[idx], nombre, rol };
  if (pass) choferes[idx].password = pass;
  try {
    await fsSet('choferes', id, choferes[idx]);
    _cache.choferes = choferes;
    closeModal('modal-edit-chofer');
    toast(`${nombre} actualizado correctamente`, 'success');
    renderAdmin();
  } catch(e) { console.error(e); toast('Error al guardar cambios', 'error'); }
}

function deleteChofer(id) {
  openModal('modal-confirm');
  document.getElementById('confirm-msg').textContent = '¿Eliminar este chofer? Esta acción no se puede deshacer.';
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeModal('modal-confirm');
    try {
      await fsDelete('choferes', id);
      _cache.choferes = _cache.choferes.filter(c => c.id !== id);
      toast('Chofer eliminado', 'info');
      renderAdmin();
    } catch(e) { toast('Error al eliminar', 'error'); }
  };
}

function openEditUnidad(id) {
  const u = DB.unidades.find(x => x.id === id);
  if (!u) return;
  document.getElementById('edit-unidad-id').value     = u.id;
  document.getElementById('edit-unidad-placa').value  = u.placa;
  document.getElementById('edit-unidad-modelo').value = u.modelo;
  openModal('modal-edit-unidad');
}

async function saveEditUnidad() {
  const id     = document.getElementById('edit-unidad-id').value;
  const placa  = document.getElementById('edit-unidad-placa').value.trim().toUpperCase();
  const modelo = document.getElementById('edit-unidad-modelo').value.trim();
  if (!placa || !modelo) { toast('Completa placa y modelo', 'warning'); return; }
  const unidades = [...DB.unidades];
  const idx = unidades.findIndex(u => u.id === id);
  if (idx === -1) { toast('Unidad no encontrada', 'error'); return; }
  unidades[idx] = { ...unidades[idx], placa, modelo };
  try {
    await fsSet('unidades', id, unidades[idx]);
    _cache.unidades = unidades;
    closeModal('modal-edit-unidad');
    toast('Unidad actualizada correctamente', 'success');
    renderAdmin();
  } catch(e) { console.error(e); toast('Error al guardar', 'error'); }
}

function deleteUnidad(id) {
  openModal('modal-confirm');
  document.getElementById('confirm-msg').textContent = '¿Eliminar esta unidad?';
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeModal('modal-confirm');
    try {
      await fsDelete('unidades', id);
      _cache.unidades = _cache.unidades.filter(u => u.id !== id);
      toast('Unidad eliminada', 'info');
      renderAdmin();
    } catch(e) { toast('Error al eliminar', 'error'); }
  };
}

function addChofer() {
  const nombre = document.getElementById('new-chofer-nombre').value.trim();
  const user   = document.getElementById('new-chofer-user').value.trim();
  const pass   = document.getElementById('new-chofer-pass').value;
  const rol    = document.getElementById('new-chofer-rol').value;
  if (!nombre || !user || !pass) { toast('Completa todos los campos', 'warning'); return; }
  if (DB.choferes.find(c => c.username === user)) { toast('El usuario ya existe', 'error'); return; }
  const c = { id: uid(), nombre, username: user, password: pass, rol };
  fsSet('choferes', c.id, c).then(() => {
    _cache.choferes.push(c);
    closeModal('modal-nuevo-chofer');
    ['new-chofer-nombre','new-chofer-user','new-chofer-pass'].forEach(id => document.getElementById(id).value = '');
    toast(`${nombre} agregado correctamente`, 'success');
    renderAdmin();
  }).catch(e => { console.error(e); toast('Error al agregar', 'error'); });
}

function addUnidad() {
  const placa  = document.getElementById('new-unidad-placa').value.trim().toUpperCase();
  const modelo = document.getElementById('new-unidad-modelo').value.trim();
  if (!placa || !modelo) { toast('Completa placa y modelo', 'warning'); return; }
  const u = { id: uid(), placa, modelo };
  fsSet('unidades', u.id, u).then(() => {
    _cache.unidades.push(u);
    closeModal('modal-nueva-unidad');
    ['new-unidad-placa','new-unidad-modelo'].forEach(id => document.getElementById(id).value = '');
    toast('Unidad agregada correctamente', 'success');
    renderAdmin();
  }).catch(e => { console.error(e); toast('Error al agregar', 'error'); });
}

// ══════════════════════════════════════════════
//  CAMBIAR CONTRASEÑA
// ══════════════════════════════════════════════
function renderPaginaUsuario() {
  const sesion = DB.sesion;
  if (!sesion) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('usuario-avatar-grande', sesion.nombre.charAt(0).toUpperCase());
  set('usuario-nombre-grande', sesion.nombre);
  set('usuario-rol-grande',    sesion.rol === 'admin' ? 'Administrador' : 'Chofer');
  set('usuario-username',      sesion.username || '—');
  set('usuario-tipo',          sesion.rol === 'admin' ? 'Administrador' : 'Chofer');
  // Limpiar campos de contraseña
  ['cp-actual','cp-nueva','cp-confirmar'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

async function cambiarPassword() {
  const actual = document.getElementById('cp-actual').value;
  const nueva  = document.getElementById('cp-nueva').value;
  const conf   = document.getElementById('cp-confirmar').value;
  const sesion = DB.sesion;
  if (!actual || !nueva || !conf) { toast('Completa todos los campos', 'warning'); return; }
  if (nueva !== conf) { toast('Las contraseñas no coinciden', 'error'); return; }
  if (nueva.length < 4) { toast('La contraseña debe tener al menos 4 caracteres', 'warning'); return; }
  const chofer = DB.choferes.find(c => c.id === sesion.id);
  if (!chofer || chofer.password !== actual) { toast('Contraseña actual incorrecta', 'error'); return; }
  try {
    await fsSet('choferes', sesion.id, { ...chofer, password: nueva });
    _cache.choferes = _cache.choferes.map(c => c.id === sesion.id ? { ...c, password: nueva } : c);
    ['cp-actual','cp-nueva','cp-confirmar'].forEach(id => document.getElementById(id).value = '');
    toast('Contraseña actualizada correctamente', 'success');
  } catch(e) { toast('Error al actualizar', 'error'); }
}

// ══════════════════════════════════════════════
//  EXPORTAR PDF HISTORIAL
// ══════════════════════════════════════════════
function exportAllPDF() {
  const sesion = DB.sesion;
  let reportes = DB.reportes;
  if (sesion.rol === 'chofer') reportes = reportes.filter(r => r.chorerId === sesion.id);

  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  const filU  = document.getElementById('f-unidad').value;
  const filC  = document.getElementById('f-chofer').value;

  reportes = reportes.filter(r => {
    if (desde && r.fecha < desde) return false;
    if (hasta && r.fecha > hasta) return false;
    if (filU  && r.unidadId !== filU) return false;
    if (filC  && r.chorerId !== filC) return false;
    return true;
  }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (!reportes.length) { toast('No hay registros para exportar', 'warning'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  doc.text('TRANSPORTES MELGAR', 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('Historial de Viajes   |   Generado: ' + new Date().toLocaleString('es-MX'), 14, 26);
  doc.setDrawColor(200, 200, 200);
  doc.line(14, 30, 283, 30);

  const totalI = reportes.reduce((s, r) => s + r.subtotalIngresos, 0);
  const totalG = reportes.reduce((s, r) => s + r.subtotalGastos,   0);
  const totalU = totalI - totalG;

  doc.autoTable({
    startY: 35,
    head: [['Fecha', 'Cliente / Destino', 'Unidad', 'Chofer', 'Ingresos', 'Gastos', 'Utilidad']],
    body: reportes.map(r => [
      fmtDate(r.fecha),
      r.cliente + (r.destino ? '\n' + r.destino : ''),
      r.unidadModelo || r.unidadPlaca,
      r.choferNombre,
      '$' + r.subtotalIngresos.toFixed(2),
      '$' + r.subtotalGastos.toFixed(2),
      '$' + r.utilidad.toFixed(2),
    ]),
    foot: [['', '', '', 'TOTALES', '$' + totalI.toFixed(2), '$' + totalG.toFixed(2), '$' + totalU.toFixed(2)]],
    theme: 'striped',
    headStyles: { fillColor: [245,245,248], textColor: [30,30,30], fontStyle: 'bold', lineColor: [210,210,215], lineWidth: 0.3 },
    footStyles: { fillColor: [245,245,248], textColor: [30,30,30], fontStyle: 'bold', lineColor: [210,210,215], lineWidth: 0.3 },
    styles: { fontSize: 8.5, cellPadding: 3, textColor: [30,30,30] },
    alternateRowStyles: { fillColor: [250,250,252] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
    showFoot: 'lastPage',
  });

  doc.save('historial-melgar-' + new Date().toISOString().split('T')[0] + '.pdf');
  toast('Reporte PDF exportado', 'success');
}

// ══════════════════════════════════════════════
//  WHATSAPP
// ══════════════════════════════════════════════
function shareWhatsApp(id) {
  const r = DB.reportes.find(x => x.id === id);
  if (!r) return;
  const lines = [
    '🚛 *TRANSPORTES MELGAR*', '📋 Reporte de Viaje', '',
    '📅 Fecha: ' + fmtDate(r.fecha),
    '🏢 Cliente: ' + r.cliente,
    '📍 Destino: ' + (r.destino || '—'),
    '📦 Entregado a: ' + (r.entregadoA || '—'),
    '🚚 Unidad: ' + r.unidadPlaca + ' — ' + r.unidadModelo,
    '👤 Chofer: ' + r.choferNombre, '',
    '💵 *INGRESOS*',
    '  • Precio de viaje: $' + r.flete.toFixed(2),
    ...(r.ingresosExtra || []).map(i => '  • ' + i.concepto + ': $' + i.monto.toFixed(2)),
    '  📊 Total: *$' + r.subtotalIngresos.toFixed(2) + '*', '',
    '💸 *GASTOS*',
    ...((r.gastos || []).length
      ? (r.gastos || []).map(g => '  • ' + g.concepto + ': $' + g.monto.toFixed(2))
      : ['  • Sin gastos']),
    '  📊 Total: *$' + r.subtotalGastos.toFixed(2) + '*', '',
    (r.utilidad >= 0 ? '✅' : '❌') + ' *UTILIDAD NETA: $' + r.utilidad.toFixed(2) + '*',
  ];
  window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
}

// ══════════════════════════════════════════════
//  ARRANQUE
// ══════════════════════════════════════════════
_fbReady.then(async () => {
  const sesionGuardada = DB.sesion;
  if (sesionGuardada) {
    document.getElementById('login-btn').disabled = true;
    document.getElementById('login-btn').innerHTML = '<div class="spinner"></div>';
    try {
      await initDefaults();
      showApp();
    } catch(e) {
      document.getElementById('login-btn').disabled = false;
      document.getElementById('login-btn').innerHTML = 'Iniciar Sesión';
    }
  }
}).catch(err => {
  console.error('Error Firebase:', err);
  document.getElementById('login-screen').style.display = 'flex';
  toast('Advertencia: problema de conexión con la base de datos.', 'warning');
});

// ── Firebase Init ──
const firebaseConfig = {
      apiKey:            "AIzaSyANMpH5oor6DOuy5IaiU5LxLxxX5Vb5bik",
      authDomain:        "basetransportesmelgar.firebaseapp.com",
      projectId:         "basetransportesmelgar",
      storageBucket:     "basetransportesmelgar.firebasestorage.app",
      messagingSenderId: "440678791212",
      appId:             "1:440678791212:web:a45ca9a46a7c285fab7989"
    };
    firebase.initializeApp(firebaseConfig);
    window._db = firebase.firestore();
    window._firebaseReady = true;