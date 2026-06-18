window.addEventListener('DOMContentLoaded', () => {
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('dFecha').value = hoy;
  document.getElementById('rDesde').value = hoy;
  document.getElementById('rHasta').value = hoy;
  cargarDia();
  cargarModelos();
});

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function showTab(id, btn) {
  document.querySelectorAll('.mgr-tab-content').forEach(t => t.classList.remove('activa'));
  document.querySelectorAll('.mgr-tab').forEach(t => t.classList.remove('activa'));
  document.getElementById(id).classList.add('activa');
  btn.classList.add('activa');
}

function fmtFecha(str) {
  if (!str) return '';
  const [y,m,d] = str.split('-');
  return `${d}/${m}/${y}`;
}

// ── POR DÍA ──────────────────────────────────────────────────────────────────
async function cargarDia() {
  const fecha = document.getElementById('dFecha').value;
  if (!fecha) return;
  try {
    const { prod, tiempos, turnos } = await api('GET', `/api/reporte/dia?fecha=${fecha}`);
    const el = document.getElementById('dResultado');
    el.innerHTML = '';

    if (!turnos.length) {
      el.innerHTML = '<div class="empty-state">Sin producción este día</div>';
      return;
    }

    // Total global
    const granTotal = prod.reduce((s, r) => s + r.total, 0);
    const granMin = tiempos.reduce((s, r) => s + r.minutos, 0);
    el.innerHTML = `
      <div class="resumen-cards">
        <div class="stat-card">
          <div class="stat-num">${granTotal.toLocaleString()}</div>
          <div class="stat-label">Total Piezas</div>
        </div>
        <div class="stat-card">
          <div class="stat-num warning">${granMin}</div>
          <div class="stat-label">Min. Muerto</div>
        </div>
      </div>
    `;

    // Por turno
    const TURNOS = ['Matutino','Vespertino','Nocturno'];
    TURNOS.forEach(turno => {
      const tInfo = turnos.find(t => t.turno === turno);
      if (!tInfo) return;

      const prodTurno = prod.filter(r => r.turno === turno);
      const totalTurno = prodTurno.reduce((s, r) => s + r.total, 0);
      const muertosTurno = tiempos.filter(r => r.turno === turno);
      const minTurno = muertosTurno.reduce((s, r) => s + r.minutos, 0);

      const card = document.createElement('div');
      card.className = 'turno-card';

      let modelosHTML = '';
      prodTurno.forEach(r => {
        modelosHTML += `<div class="modelo-row"><span class="modelo-nombre">${r.modelo}</span><span class="modelo-cant">${r.total.toLocaleString()}</span></div>`;
      });
      if (!prodTurno.length) modelosHTML = '<div style="color:#94a3b8;font-size:.85rem">Sin producción registrada</div>';

      const estado = tInfo.estado === 'abierto' ? '🟢 Abierto' : '🔴 Cerrado';
      card.innerHTML = `
        <div class="turno-card-header">
          <div>
            <div class="turno-nombre">Turno ${turno}</div>
            <div class="turno-sub">${estado}${minTurno ? ` · ⏸ ${minTurno} min muertos` : ''}</div>
          </div>
          <div class="turno-total">${totalTurno.toLocaleString()}</div>
        </div>
        <div class="turno-modelos">${modelosHTML}</div>
        <button class="btn-ver-detalle" onclick="verDetalle(${tInfo.id}, '${turno}', '${fecha}')">Ver detalle completo</button>
      `;
      el.appendChild(card);

      if (muertosTurno.length) {
        const mDiv = document.createElement('div');
        mDiv.className = 'muertos-wrap';
        let mHTML = `<div class="muertos-title">⏸ Tiempos Muertos — ${turno}</div>`;
        muertosTurno.forEach(r => {
          mHTML += `<div class="muerto-row"><span>${r.motivo}</span><span style="font-weight:700;color:#d97706">${r.minutos} min</span></div>`;
        });
        mDiv.innerHTML = mHTML;
        el.appendChild(mDiv);
      }
    });
  } catch (e) { alert(e.message); }
}

// ── RANGO ─────────────────────────────────────────────────────────────────────
async function cargarRango() {
  const desde = document.getElementById('rDesde').value;
  const hasta = document.getElementById('rHasta').value;
  if (!desde || !hasta) return;
  try {
    const rows = await api('GET', `/api/reporte/rango?desde=${desde}&hasta=${hasta}`);
    const el = document.getElementById('rResultado');
    el.innerHTML = '';
    if (!rows.length) { el.innerHTML = '<div class="empty-state">Sin producción en ese rango</div>'; return; }

    const granTotal = rows.reduce((s, r) => s + r.total, 0);
    const bar = document.createElement('div');
    bar.className = 'gran-total-bar';
    bar.innerHTML = `<span class="gt-label">Total del período</span><span class="gt-num">${granTotal.toLocaleString()} pzs</span>`;
    el.appendChild(bar);

    // Agrupar por fecha
    const porFecha = {};
    rows.forEach(r => {
      if (!porFecha[r.fecha]) porFecha[r.fecha] = [];
      porFecha[r.fecha].push(r);
    });

    const sec = document.createElement('div');
    sec.className = 'rango-section';
    Object.keys(porFecha).sort().reverse().forEach(fecha => {
      const titulo = document.createElement('div');
      titulo.className = 'rango-title';
      titulo.textContent = fmtFecha(fecha);
      sec.appendChild(titulo);

      porFecha[fecha].forEach(r => {
        const div = document.createElement('div');
        div.className = 'rango-row';
        div.innerHTML = `
          <div class="rango-info">
            <span class="rango-fecha">Turno ${r.turno}</span>
            <span class="rango-desc">${r.modelo}</span>
          </div>
          <span class="rango-cant">${r.total.toLocaleString()}</span>
        `;
        sec.appendChild(div);
      });
    });
    el.appendChild(sec);
  } catch (e) { alert(e.message); }
}

// ── DETALLE TURNO ─────────────────────────────────────────────────────────────
async function verDetalle(id, turno, fecha) {
  document.getElementById('detalleTitulo').textContent = `${turno} — ${fmtFecha(fecha)}`;
  const { prod, tiempos } = await api('GET', `/api/reporte/turno/${id}`);
  const el = document.getElementById('detalleContenido');
  el.innerHTML = '';

  if (!prod.length && !tiempos.length) {
    el.innerHTML = '<div class="empty-state">Sin registros</div>';
  } else {
    // Producción por hora
    const porHora = {};
    prod.forEach(r => { if (!porHora[r.hora]) porHora[r.hora] = []; porHora[r.hora].push(r); });

    if (Object.keys(porHora).length) {
      const h = document.createElement('div');
      h.className = 'detalle-hora';
      h.textContent = 'Producción';
      el.appendChild(h);
      Object.keys(porHora).sort().forEach(hora => {
        porHora[hora].forEach(r => {
          const row = document.createElement('div');
          row.className = 'detalle-row';
          row.innerHTML = `<span>${hora} · <strong>${r.modelo}</strong></span><span style="font-weight:700;color:#1a56db">${r.cantidad.toLocaleString()}</span>`;
          el.appendChild(row);
        });
      });
    }

    if (tiempos.length) {
      const h2 = document.createElement('div');
      h2.className = 'detalle-hora';
      h2.textContent = 'Tiempos Muertos';
      el.appendChild(h2);
      tiempos.forEach(r => {
        const row = document.createElement('div');
        row.className = 'detalle-row';
        row.innerHTML = `<span>${r.hora} · ${r.motivo}</span><span style="font-weight:700;color:#d97706">${r.minutos} min</span>`;
        el.appendChild(row);
      });
    }
  }

  document.getElementById('modalDetalle').classList.remove('hidden');
}

function cerrarDetalle() { document.getElementById('modalDetalle').classList.add('hidden'); }

// ── MODELOS ───────────────────────────────────────────────────────────────────
async function cargarModelos() {
  const rows = await api('GET', '/api/modelos');
  const el = document.getElementById('listaModelos');
  el.innerHTML = '';
  rows.forEach(m => {
    const div = document.createElement('div');
    div.className = 'modelo-item';
    div.innerHTML = `<span class="modelo-item-nombre">${m.nombre}</span><button class="btn-del-modelo" onclick="eliminarModelo(${m.id})">🗑</button>`;
    el.appendChild(div);
  });
}

async function agregarModelo() {
  const nombre = document.getElementById('nuevoModelo').value.trim().toUpperCase();
  if (!nombre) return;
  try {
    await api('POST', '/api/modelos', { nombre });
    document.getElementById('nuevoModelo').value = '';
    cargarModelos();
  } catch (e) { alert(e.message); }
}

async function eliminarModelo(id) {
  if (!confirm('¿Desactivar este modelo?')) return;
  await api('DELETE', `/api/modelos/${id}`);
  cargarModelos();
}
