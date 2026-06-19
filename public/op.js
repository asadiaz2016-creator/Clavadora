let turnoActivo = null;
let modelos = [];
let modeloSel = null;
let motivoSel = null;
let prodRows = [];
let muertosRows = [];

const HORAS = [
  '06:00-07:00','07:00-08:00','08:00-09:00','09:00-10:00',
  '10:00-11:00','11:00-12:00','12:00-13:00','13:00-14:00',
  '14:00-15:00','15:00-16:00','16:00-17:00','17:00-18:00',
  '18:00-19:00','19:00-20:00','20:00-21:00','21:00-22:00',
  '22:00-23:00','23:00-00:00'
];

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const hoy = new Date();
  document.getElementById('fechaHoy').textContent = hoy.toLocaleDateString('es-MX', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  });

  modelos = await api('GET', '/api/modelos');

  const saved = localStorage.getItem('turnoActivo');
  if (saved) {
    turnoActivo = JSON.parse(saved);
    const activo = await api('GET', `/api/turnos/activo/${turnoActivo.turno}`);
    if (activo && activo.id === turnoActivo.id) {
      mostrarPantallaOp();
      return;
    } else {
      localStorage.removeItem('turnoActivo');
    }
  }
  document.getElementById('pantallaInicio').classList.add('activa');
});

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function horaActual() {
  const h = new Date().getHours();
  const efectiva = h < 6 ? 6 : h;
  const inicio = String(efectiva).padStart(2,'0') + ':00';
  const fin = String((efectiva + 1) % 24).padStart(2,'0') + ':00';
  return `${inicio}-${fin}`;
}

function fechaHoy() {
  return new Date().toISOString().split('T')[0];
}

function llenarHoras(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '';
  const actual = horaActual();
  HORAS.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h; opt.textContent = h;
    if (h === actual) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── INICIO ────────────────────────────────────────────────────────────────────
async function seleccionarTurno(turno) {
  const errEl = document.getElementById('errorInicio');
  errEl.classList.add('hidden');
  try {
    const existente = await api('GET', `/api/turnos/activo/${turno}`);
    if (existente) {
      turnoActivo = existente;
    } else {
      turnoActivo = await api('POST', '/api/turnos', { turno, fecha: fechaHoy() });
    }
    localStorage.setItem('turnoActivo', JSON.stringify(turnoActivo));
    mostrarPantallaOp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

function mostrarPantallaOp() {
  document.getElementById('pantallaInicio').classList.remove('activa');
  document.getElementById('pantallaOp').classList.add('activa');
  document.getElementById('opTurnoLabel').textContent = `Turno ${turnoActivo.turno}`;
  const [y,m,d] = turnoActivo.fecha.split('-');
  document.getElementById('opFechaLabel').textContent = `${d}/${m}/${y}`;
  cargarDatos();
}

async function cargarDatos() {
  [prodRows, muertosRows] = await Promise.all([
    api('GET', `/api/produccion/${turnoActivo.id}`),
    api('GET', `/api/tiempos/${turnoActivo.id}`)
  ]);
  renderProd();
  renderMuertos();
  actualizarTotal();
}

function actualizarTotal() {
  const total = prodRows.reduce((s, r) => s + r.cantidad, 0);
  document.getElementById('opTotalNum').textContent = total.toLocaleString();
}

// ── RENDER PRODUCCIÓN ─────────────────────────────────────────────────────────
function renderProd() {
  const el = document.getElementById('listaProd');
  if (!prodRows.length) {
    el.innerHTML = '<div class="empty-state">Sin registros aún</div>';
    return;
  }
  el.innerHTML = '';
  prodRows.forEach(r => {
    const div = document.createElement('div');
    div.className = 'registro-item';
    div.innerHTML = `
      <div class="reg-info">
        <span class="reg-modelo">${r.modelo_nombre}</span>
        <span class="reg-hora">${r.hora}</span>
      </div>
      <div class="reg-right">
        <span class="reg-cantidad">${r.cantidad.toLocaleString()}</span>
        <button class="btn-del" onclick="eliminarProd(${r.id})">🗑</button>
      </div>`;
    el.appendChild(div);
  });
}

// ── RENDER TIEMPOS MUERTOS ────────────────────────────────────────────────────
function renderMuertos() {
  const el = document.getElementById('listaMuerto');
  const totalMin = muertosRows.reduce((s, r) => s + r.minutos, 0);
  const totalEl = document.getElementById('listaMinutos');
  if (!muertosRows.length) {
    el.innerHTML = '<div class="empty-state">Sin tiempos muertos</div>';
    totalEl.classList.add('hidden');
    return;
  }
  totalEl.classList.remove('hidden');
  document.getElementById('totalMinutos').textContent = totalMin;
  el.innerHTML = '';
  muertosRows.forEach(r => {
    const div = document.createElement('div');
    div.className = 'registro-item';
    div.innerHTML = `
      <div class="reg-info">
        <span class="reg-motivo">${r.motivo}</span>
      </div>
      <div class="reg-right">
        <span class="reg-minutos">${r.minutos} min</span>
        <button class="btn-del" onclick="eliminarMuerto(${r.id})">🗑</button>
      </div>`;
    el.appendChild(div);
  });
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function mostrarTab(tabId, btn) {
  document.querySelectorAll('.res-contenido').forEach(t => t.classList.remove('activa'));
  document.querySelectorAll('.res-tab').forEach(t => t.classList.remove('activa'));
  document.getElementById(tabId).classList.add('activa');
  btn.classList.add('activa');
}

// ── MODAL PRODUCCIÓN ──────────────────────────────────────────────────────────
function abrirModalProd() {
  modeloSel = null;
  llenarHoras('pHora');
  document.getElementById('pCantidad').value = '';
  document.getElementById('nuevoModeloInput').value = '';
  document.getElementById('nuevoModeloWrap').classList.add('hidden');
  renderModeloGrid();
  document.getElementById('modalProd').classList.remove('hidden');
  setTimeout(() => document.getElementById('pCantidad').focus(), 300);
}

function renderModeloGrid() {
  const grid = document.getElementById('modeloGrid');
  grid.innerHTML = '';
  modelos.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'btn-modelo' + (modeloSel === m.id ? ' seleccionado' : '');
    btn.textContent = m.nombre;
    btn.onclick = () => {
      modeloSel = m.id;
      document.querySelectorAll('.btn-modelo').forEach(b => b.classList.remove('seleccionado'));
      btn.classList.add('seleccionado');
    };
    grid.appendChild(btn);
  });
}

function mostrarNuevoModelo() {
  document.getElementById('nuevoModeloWrap').classList.remove('hidden');
  document.getElementById('nuevoModeloInput').focus();
}

async function agregarModelo() {
  const nombre = document.getElementById('nuevoModeloInput').value.trim().toUpperCase();
  if (!nombre) return;
  try {
    const m = await api('POST', '/api/modelos', { nombre });
    modelos.push(m);
    modeloSel = m.id;
    document.getElementById('nuevoModeloInput').value = '';
    document.getElementById('nuevoModeloWrap').classList.add('hidden');
    renderModeloGrid();
  } catch (e) { alert(e.message); }
}

async function guardarProd() {
  if (!modeloSel) return alert('Selecciona un modelo de tarima');
  const cantidad = parseInt(document.getElementById('pCantidad').value);
  if (!cantidad || cantidad < 1) return alert('Ingresa la cantidad');
  const hora = document.getElementById('pHora').value;
  try {
    await api('POST', '/api/produccion', { turno_id: turnoActivo.id, modelo_id: modeloSel, hora, cantidad });
    cerrarModal('modalProd');
    await cargarDatos();
  } catch (e) { alert(e.message); }
}

async function eliminarProd(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await api('DELETE', `/api/produccion/${id}`);
  await cargarDatos();
}

// ── MODAL TIEMPO MUERTO ───────────────────────────────────────────────────────
function abrirModalMuerto() {
  motivoSel = null;
  document.getElementById('mMinutos').value = '';
  document.getElementById('mMotivoCustom').value = '';
  document.getElementById('otroWrap').classList.add('hidden');
  document.querySelectorAll('.btn-motivo').forEach(b => b.classList.remove('seleccionado'));
  document.getElementById('modalMuerto').classList.remove('hidden');
}

function selMotivo(btn) {
  document.querySelectorAll('.btn-motivo').forEach(b => b.classList.remove('seleccionado'));
  btn.classList.add('seleccionado');
  motivoSel = btn.textContent;
  if (motivoSel === 'Otro') {
    document.getElementById('otroWrap').classList.remove('hidden');
    setTimeout(() => document.getElementById('mMotivoCustom').focus(), 100);
  } else {
    document.getElementById('otroWrap').classList.add('hidden');
  }
}

async function guardarMuerto() {
  let motivo = motivoSel;
  if (!motivo) return alert('Selecciona el motivo');
  if (motivo === 'Otro') {
    motivo = document.getElementById('mMotivoCustom').value.trim();
    if (!motivo) return alert('Escribe el motivo del tiempo muerto');
  }
  const minutos = parseInt(document.getElementById('mMinutos').value);
  if (!minutos || minutos < 1) return alert('Ingresa los minutos');
  const hora = horaActual();
  try {
    await api('POST', '/api/tiempos', { turno_id: turnoActivo.id, motivo, minutos, hora });
    cerrarModal('modalMuerto');
    await cargarDatos();
    mostrarTab('tabMuerto', document.querySelectorAll('.res-tab')[1]);
  } catch (e) { alert(e.message); }
}

async function eliminarMuerto(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await api('DELETE', `/api/tiempos/${id}`);
  await cargarDatos();
}

// ── REPORTE ───────────────────────────────────────────────────────────────────
function compartirReporte() {
  const [y,m,d] = turnoActivo.fecha.split('-');
  const fecha = `${d}/${m}/${y}`;
  const ahora = new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });

  // Producción por modelo
  const porModelo = {};
  prodRows.forEach(r => {
    porModelo[r.modelo_nombre] = (porModelo[r.modelo_nombre] || 0) + r.cantidad;
  });
  const totalProd = prodRows.reduce((s, r) => s + r.cantidad, 0);

  // Producción por hora
  const porHora = {};
  prodRows.forEach(r => {
    porHora[r.hora] = (porHora[r.hora] || 0) + r.cantidad;
  });

  // Tiempos muertos por motivo
  const porMotivo = {};
  muertosRows.forEach(r => {
    porMotivo[r.motivo] = (porMotivo[r.motivo] || 0) + r.minutos;
  });
  const totalMin = muertosRows.reduce((s, r) => s + r.minutos, 0);

  // Eficiencia (horas trabajadas estimadas vs tiempo muerto)
  const horasConProduccion = Object.keys(porHora).length;
  const eficiencia = totalMin > 0 && horasConProduccion > 0
    ? Math.max(0, Math.round(100 - (totalMin / (horasConProduccion * 60)) * 100))
    : 100;
  const promXHora = horasConProduccion > 0
    ? Math.round(totalProd / horasConProduccion)
    : 0;

  const SEP  = '================================';
  const SEP2 = '--------------------------------';

  let txt = '';
  txt += `${SEP}\n`;
  txt += ` CUSTOM CRATES & PALLETS, INC.\n`;
  txt += `${SEP}\n`;
  txt += ` Reporte de Producción\n`;
  txt += ` Turno : ${turnoActivo.turno}\n`;
  txt += ` Fecha : ${fecha}\n`;
  txt += ` Hora  : ${ahora}\n`;
  txt += `${SEP}\n\n`;

  txt += `📦 RESUMEN DE PRODUCCIÓN\n`;
  txt += `${SEP2}\n`;
  if (Object.keys(porModelo).length) {
    const maxLen = Math.max(...Object.keys(porModelo).map(m => m.length));
    Object.entries(porModelo)
      .sort((a,b) => b[1]-a[1])
      .forEach(([modelo, cant]) => {
        const pad = ' '.repeat(Math.max(1, maxLen - modelo.length + 2));
        txt += ` ${modelo}${pad}${cant.toLocaleString()} pzs\n`;
      });
    txt += `${SEP2}\n`;
    txt += ` TOTAL           ${totalProd.toLocaleString()} pzs\n`;
    txt += ` Promedio/hora   ${promXHora.toLocaleString()} pzs\n`;
  } else {
    txt += ` Sin producción registrada\n`;
  }

  txt += `\n📊 PRODUCCIÓN POR HORA\n`;
  txt += `${SEP2}\n`;
  if (Object.keys(porHora).length) {
    Object.entries(porHora)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .forEach(([hora, cant]) => {
        const barra = '█'.repeat(Math.min(10, Math.round(cant / Math.max(...Object.values(porHora)) * 10)));
        txt += ` ${hora}  ${barra} ${cant}\n`;
      });
  } else {
    txt += ` Sin registros\n`;
  }

  txt += `\n⏸ TIEMPOS MUERTOS\n`;
  txt += `${SEP2}\n`;
  if (Object.keys(porMotivo).length) {
    Object.entries(porMotivo)
      .sort((a,b) => b[1]-a[1])
      .forEach(([motivo, min]) => {
        txt += ` ${motivo}: ${min} min\n`;
      });
    txt += `${SEP2}\n`;
    txt += ` TOTAL         ${totalMin} minutos\n`;
  } else {
    txt += ` Sin tiempos muertos ✅\n`;
  }

  txt += `\n⚡ EFICIENCIA DEL TURNO\n`;
  txt += `${SEP2}\n`;
  const barraEf = '█'.repeat(Math.round(eficiencia / 10)) + '░'.repeat(10 - Math.round(eficiencia / 10));
  txt += ` [${barraEf}] ${eficiencia}%\n`;

  txt += `\n${SEP}\n`;
  txt += ` Generado por Sistema Clavadora\n`;
  txt += `${SEP}\n`;

  document.getElementById('reporteTexto').textContent = txt;
  document.getElementById('modalReporte').classList.remove('hidden');
}

function enviarReporte() {
  const texto = document.getElementById('reporteTexto').textContent;
  const url = 'https://wa.me/?text=' + encodeURIComponent(texto);
  window.open(url, '_blank');
}

// ── CERRAR TURNO ─────────────────────────────────────────────────────────────
async function cerrarTurno() {
  const total = prodRows.reduce((s, r) => s + r.cantidad, 0);
  if (!confirm(`¿Cerrar turno?\nTotal producido: ${total.toLocaleString()} piezas`)) return;
  try {
    await api('PUT', `/api/turnos/${turnoActivo.id}/cerrar`);
    localStorage.removeItem('turnoActivo');
    turnoActivo = null;
    prodRows = []; muertosRows = [];
    document.getElementById('pantallaOp').classList.remove('activa');
    document.getElementById('pantallaInicio').classList.add('activa');
  } catch (e) { alert(e.message); }
}

function cerrarModal(id) { document.getElementById(id).classList.add('hidden'); }
