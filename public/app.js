let token = localStorage.getItem('token');
let userInfo = JSON.parse(localStorage.getItem('userInfo') || 'null');
let turnoActivo = null;
let modelos = [];

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().split('T')[0];
  const el = document.getElementById('turnoFecha');
  if (el) el.value = today;

  const rDesde = document.getElementById('rDesde');
  const rHasta = document.getElementById('rHasta');
  if (rDesde) rDesde.value = today;
  if (rHasta) rHasta.value = today;

  // Enter key on login
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  if (token && userInfo) {
    showApp();
  } else {
    showScreen('loginScreen');
  }
});

// ── API helper ─────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

// ── SCREENS ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showApp() {
  if (!userInfo) return showScreen('loginScreen');
  if (userInfo.rol === 'manager') {
    showScreen('managerScreen');
    document.getElementById('managerUser').textContent = userInfo.nombre;
    cargarModelosMgr();
    cargarReporte();
    cargarTurnos();
    cargarUsuarios();
  } else {
    showScreen('operadorScreen');
    document.getElementById('headerUser').textContent = userInfo.nombre;
    cargarModelos().then(cargarTurnoActivo);
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function login() {
  const usuario = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!usuario || !password) { errEl.textContent = 'Ingresa usuario y contraseña'; errEl.classList.remove('hidden'); return; }
  try {
    const data = await api('POST', '/api/login', { usuario, password });
    token = data.token;
    userInfo = { nombre: data.nombre, rol: data.rol };
    localStorage.setItem('token', token);
    localStorage.setItem('userInfo', JSON.stringify(userInfo));
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

function logout() {
  token = null; userInfo = null; turnoActivo = null;
  localStorage.removeItem('token'); localStorage.removeItem('userInfo');
  showScreen('loginScreen');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

// ── MODELOS ───────────────────────────────────────────────────────────────────
async function cargarModelos() {
  modelos = await api('GET', '/api/modelos');
  const sel = document.getElementById('prodModelo');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Selecciona --</option>';
  modelos.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.nombre;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function mostrarAgregarModelo() {
  document.getElementById('nuevoModeloOp').value = '';
  document.getElementById('modalModelo').classList.remove('hidden');
}

function cerrarModal() { document.getElementById('modalModelo').classList.add('hidden'); }

async function agregarModeloOp() {
  const nombre = document.getElementById('nuevoModeloOp').value.trim().toUpperCase();
  if (!nombre) return alert('Ingresa el nombre del modelo');
  try {
    const m = await api('POST', '/api/modelos', { nombre });
    modelos.push(m);
    await cargarModelos();
    document.getElementById('prodModelo').value = m.id;
    cerrarModal();
  } catch (e) { alert(e.message); }
}

// ── TURNO OPERADOR ────────────────────────────────────────────────────────────
async function cargarTurnoActivo() {
  turnoActivo = await api('GET', '/api/turnos/activo');
  if (turnoActivo) {
    mostrarConTurno();
  } else {
    document.getElementById('noTurno').classList.remove('hidden');
    document.getElementById('conTurno').classList.add('hidden');
    document.getElementById('turnoStatus').textContent = '';
  }
}

function mostrarConTurno() {
  document.getElementById('noTurno').classList.add('hidden');
  document.getElementById('conTurno').classList.remove('hidden');
  document.getElementById('turnoInfo').innerHTML = `
    <div class="ti-item"><span class="ti-label">Fecha</span><span class="ti-value">${formatDate(turnoActivo.fecha)}</span></div>
    <div class="ti-item"><span class="ti-label">Turno</span><span class="ti-value">${turnoActivo.turno}</span></div>
    <div class="ti-item"><span class="ti-label">Operador</span><span class="ti-value">${userInfo.nombre}</span></div>
    <div class="ti-item"><span class="ti-label">Estado</span><span class="ti-value">🟢 Activo</span></div>
  `;
  document.getElementById('turnoStatus').textContent = `Turno ${turnoActivo.turno} — ${formatDate(turnoActivo.fecha)}`;
  cargarProduccionTurno();
}

async function iniciarTurno() {
  const fecha = document.getElementById('turnoFecha').value;
  const turno = document.getElementById('turnoNombre').value;
  if (!fecha) return alert('Selecciona la fecha');
  try {
    turnoActivo = await api('POST', '/api/turnos', { fecha, turno });
    mostrarConTurno();
  } catch (e) { alert(e.message); }
}

async function cerrarTurno() {
  if (!confirm('¿Estás seguro de cerrar el turno? Ya no podrás agregar registros.')) return;
  try {
    await api('PUT', `/api/turnos/${turnoActivo.id}/cerrar`);
    turnoActivo = null;
    await cargarTurnoActivo();
    alert('Turno cerrado correctamente.');
  } catch (e) { alert(e.message); }
}

// ── PRODUCCION ────────────────────────────────────────────────────────────────
async function cargarProduccionTurno() {
  if (!turnoActivo) return;
  const rows = await api('GET', `/api/produccion/turno/${turnoActivo.id}`);
  renderTablaProduccion(rows);
}

function renderTablaProduccion(rows) {
  const tbody = document.getElementById('prodBody');
  tbody.innerHTML = '';

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Sin registros aún</td></tr>';
    document.getElementById('totalesOp').innerHTML = '';
    return;
  }

  // Totales por modelo
  const totPorModelo = {};
  let gran_total = 0;
  rows.forEach(r => {
    totPorModelo[r.modelo_nombre] = (totPorModelo[r.modelo_nombre] || 0) + r.cantidad;
    gran_total += r.cantidad;
  });

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.hora}</td>
      <td><strong>${r.modelo_nombre}</strong></td>
      <td>${r.cantidad.toLocaleString()}</td>
      <td style="color:var(--text-muted);font-size:.85rem">${r.notas || ''}</td>
      <td><button class="btn-icon" onclick="eliminarRegistro(${r.id})" title="Eliminar">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Totales
  const totalesEl = document.getElementById('totalesOp');
  let html = `<div class="total-item"><span class="total-label">Total</span><span class="total-value">${gran_total.toLocaleString()}</span></div>`;
  Object.entries(totPorModelo).forEach(([modelo, total]) => {
    html += `<div class="total-item"><span class="total-label">${modelo}</span><span class="total-value">${total.toLocaleString()}</span></div>`;
  });
  totalesEl.innerHTML = html;
}

async function registrarProduccion() {
  const modelo_id = document.getElementById('prodModelo').value;
  const hora = document.getElementById('prodHora').value;
  const cantidad = parseInt(document.getElementById('prodCantidad').value);
  const notas = document.getElementById('prodNotas').value;

  if (!modelo_id) return alert('Selecciona un modelo de tarima');
  if (!cantidad || cantidad < 1) return alert('Ingresa una cantidad válida');
  if (!turnoActivo) return alert('No hay turno activo');

  try {
    await api('POST', '/api/produccion', { turno_id: turnoActivo.id, modelo_id, hora, cantidad, notas });
    document.getElementById('prodCantidad').value = '';
    document.getElementById('prodNotas').value = '';
    await cargarProduccionTurno();
  } catch (e) { alert(e.message); }
}

async function eliminarRegistro(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await api('DELETE', `/api/produccion/${id}`);
  cargarProduccionTurno();
}

// ── MANAGER: TABS ─────────────────────────────────────────────────────────────
function showTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  event.target.classList.add('active');
}

// ── MANAGER: REPORTES ─────────────────────────────────────────────────────────
async function cargarReporte() {
  const desde = document.getElementById('rDesde').value;
  const hasta = document.getElementById('rHasta').value;
  if (!desde || !hasta) return;
  try {
    const rows = await api('GET', `/api/reportes/rango?desde=${desde}&hasta=${hasta}`);
    const tbody = document.getElementById('reporteBody');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Sin producción en ese rango</td></tr>';
      document.getElementById('reporteTotales').innerHTML = '';
      return;
    }
    const totModelo = {};
    let granTotal = 0;
    rows.forEach(r => {
      totModelo[r.modelo] = (totModelo[r.modelo] || 0) + r.total;
      granTotal += r.total;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${formatDate(r.fecha)}</td><td>${r.operador}</td><td>${r.turno}</td><td><strong>${r.modelo}</strong></td><td>${r.total.toLocaleString()}</td>`;
      tbody.appendChild(tr);
    });
    let html = `<div class="total-item"><span class="total-label">Gran Total</span><span class="total-value">${granTotal.toLocaleString()}</span></div>`;
    Object.entries(totModelo).sort((a,b)=>b[1]-a[1]).forEach(([m,t]) => {
      html += `<div class="total-item"><span class="total-label">${m}</span><span class="total-value">${t.toLocaleString()}</span></div>`;
    });
    document.getElementById('reporteTotales').innerHTML = html;
  } catch (e) { alert(e.message); }
}

// ── MANAGER: TURNOS ───────────────────────────────────────────────────────────
async function cargarTurnos() {
  const fecha = document.getElementById('filtroFechaTurno').value;
  const url = fecha ? `/api/reportes/turnos?fecha=${fecha}` : '/api/reportes/turnos';
  try {
    const rows = await api('GET', url);
    const tbody = document.getElementById('turnosBody');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Sin turnos registrados</td></tr>';
      return;
    }
    rows.forEach(r => {
      const badge = r.estado === 'abierto'
        ? '<span class="badge badge-green">Abierto</span>'
        : '<span class="badge badge-gray">Cerrado</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(r.fecha)}</td>
        <td>${r.turno}</td>
        <td>${r.operador}</td>
        <td>${badge}</td>
        <td style="font-size:.8rem;color:var(--text-muted)">${r.creado_en || ''}</td>
        <td style="font-size:.8rem;color:var(--text-muted)">${r.cerrado_en || '—'}</td>
        <td><strong>${r.total_piezas.toLocaleString()}</strong></td>
        <td><button class="btn btn-sm btn-outline" onclick="verDetalleTurno(${r.id},'${r.operador}','${r.fecha}','${r.turno}')">Ver</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) { alert(e.message); }
}

async function verDetalleTurno(id, operador, fecha, turno) {
  document.getElementById('detalleTurnoTitulo').textContent = `${operador} — ${formatDate(fecha)} (${turno})`;
  const rows = await api('GET', `/api/produccion/turno/${id}`);
  const tbody = document.getElementById('detalleTurnoBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Sin registros</td></tr>';
  } else {
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.hora}</td><td><strong>${r.modelo_nombre}</strong></td><td>${r.cantidad.toLocaleString()}</td><td style="font-size:.85rem;color:var(--text-muted)">${r.notas||''}</td>`;
      tbody.appendChild(tr);
    });
  }
  document.getElementById('modalDetalleTurno').classList.remove('hidden');
}

function cerrarModalDetalle() { document.getElementById('modalDetalleTurno').classList.add('hidden'); }

// ── MANAGER: MODELOS ──────────────────────────────────────────────────────────
async function cargarModelosMgr() {
  const data = await api('GET', '/api/modelos');
  const tbody = document.getElementById('modelosMgrBody');
  tbody.innerHTML = '';
  data.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${m.nombre}</strong></td><td><button class="btn-icon" onclick="eliminarModeloMgr(${m.id})" title="Desactivar">✕</button></td>`;
    tbody.appendChild(tr);
  });
}

async function agregarModeloMgr() {
  const nombre = document.getElementById('nuevoModeloMgr').value.trim().toUpperCase();
  if (!nombre) return alert('Ingresa el nombre del modelo');
  try {
    await api('POST', '/api/modelos', { nombre });
    document.getElementById('nuevoModeloMgr').value = '';
    cargarModelosMgr();
  } catch (e) { alert(e.message); }
}

async function eliminarModeloMgr(id) {
  if (!confirm('¿Desactivar este modelo? Ya no aparecerá en la lista del operador.')) return;
  await api('DELETE', `/api/modelos/${id}`);
  cargarModelosMgr();
}

// ── MANAGER: USUARIOS ─────────────────────────────────────────────────────────
async function cargarUsuarios() {
  const rows = await api('GET', '/api/usuarios');
  const tbody = document.getElementById('usuariosBody');
  tbody.innerHTML = '';
  rows.forEach(u => {
    const rolBadge = u.rol === 'manager'
      ? '<span class="badge badge-blue">Manager</span>'
      : '<span class="badge badge-gray">Operador</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.nombre}</td>
      <td><code>${u.usuario}</code></td>
      <td>${rolBadge}</td>
      <td><button class="btn btn-sm btn-outline" onclick="resetPassword(${u.id})">Reset Contraseña</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function agregarUsuario() {
  const nombre = document.getElementById('nuevoNombre').value.trim();
  const usuario = document.getElementById('nuevoUsuario').value.trim();
  const password = document.getElementById('nuevoPassword').value;
  const rol = document.getElementById('nuevoRol').value;
  if (!nombre || !usuario || !password) return alert('Todos los campos son requeridos');
  try {
    await api('POST', '/api/usuarios', { nombre, usuario, password, rol });
    document.getElementById('nuevoNombre').value = '';
    document.getElementById('nuevoUsuario').value = '';
    document.getElementById('nuevoPassword').value = '';
    cargarUsuarios();
  } catch (e) { alert(e.message); }
}

async function resetPassword(id) {
  const np = prompt('Nueva contraseña:');
  if (!np) return;
  try {
    await api('PUT', `/api/usuarios/${id}/password`, { password: np });
    alert('Contraseña actualizada');
  } catch (e) { alert(e.message); }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
