const express = require('express');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Carpeta temporal para reportes
const TEMP_DIR = path.join(os.tmpdir(), 'clavadora-reportes');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const app = express();
const PORT = 3000;
const db = new Database(path.join(__dirname, 'produccion.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS modelos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    activo INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS turnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turno TEXT NOT NULL,
    fecha TEXT NOT NULL,
    estado TEXT DEFAULT 'abierto',
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    cerrado_en TEXT
  );

  CREATE TABLE IF NOT EXISTS produccion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id INTEGER NOT NULL,
    modelo_id INTEGER NOT NULL,
    hora TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    registrado_en TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (turno_id) REFERENCES turnos(id),
    FOREIGN KEY (modelo_id) REFERENCES modelos(id)
  );

  CREATE TABLE IF NOT EXISTS tiempos_muertos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    minutos INTEGER NOT NULL,
    hora TEXT NOT NULL,
    registrado_en TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (turno_id) REFERENCES turnos(id)
  );
`);

// Seed modelos
const modelosDefault = ['72x40SD','60X40SD','42X40SD','48X40EA','60X40GB','48X40SDI','48X40BD','46X46WA','48X48WA','52X48WA'];
const insM = db.prepare('INSERT OR IGNORE INTO modelos (nombre) VALUES (?)');
modelosDefault.forEach(m => insM.run(m));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── MODELOS ──────────────────────────────────────────────────────────────────
app.get('/api/modelos', (req, res) => {
  res.json(db.prepare('SELECT * FROM modelos WHERE activo=1 ORDER BY nombre').all());
});

app.post('/api/modelos', (req, res) => {
  const nombre = req.body.nombre?.trim().toUpperCase();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = db.prepare('INSERT INTO modelos (nombre) VALUES (?)').run(nombre);
    res.json({ id: r.lastInsertRowid, nombre });
  } catch { res.status(400).json({ error: 'El modelo ya existe' }); }
});

app.delete('/api/modelos/:id', (req, res) => {
  db.prepare('UPDATE modelos SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── TURNOS ───────────────────────────────────────────────────────────────────
app.get('/api/turnos/activo/:turno', (req, res) => {
  const t = db.prepare("SELECT * FROM turnos WHERE turno=? AND estado='abierto' ORDER BY id DESC LIMIT 1").get(req.params.turno);
  res.json(t || null);
});

app.post('/api/turnos', (req, res) => {
  const { turno, fecha } = req.body;
  const existing = db.prepare("SELECT id FROM turnos WHERE turno=? AND estado='abierto'").get(turno);
  if (existing) return res.status(400).json({ error: 'Ya hay un turno abierto para este turno' });
  const r = db.prepare('INSERT INTO turnos (turno, fecha) VALUES (?,?)').run(turno, fecha);
  res.json({ id: r.lastInsertRowid, turno, fecha, estado: 'abierto' });
});

app.put('/api/turnos/:id/cerrar', (req, res) => {
  db.prepare("UPDATE turnos SET estado='cerrado', cerrado_en=datetime('now','localtime') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── PRODUCCIÓN ────────────────────────────────────────────────────────────────
app.get('/api/produccion/:turnoId', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, m.nombre as modelo_nombre
    FROM produccion p JOIN modelos m ON p.modelo_id=m.id
    WHERE p.turno_id=? ORDER BY p.hora, p.id
  `).all(req.params.turnoId));
});

app.post('/api/produccion', (req, res) => {
  const { turno_id, modelo_id, hora, cantidad } = req.body;
  if (!turno_id || !modelo_id || !hora || !cantidad) return res.status(400).json({ error: 'Faltan datos' });
  const r = db.prepare('INSERT INTO produccion (turno_id, modelo_id, hora, cantidad) VALUES (?,?,?,?)').run(turno_id, modelo_id, hora, cantidad);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/produccion/:id', (req, res) => {
  db.prepare('DELETE FROM produccion WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── TIEMPOS MUERTOS ───────────────────────────────────────────────────────────
app.get('/api/tiempos/:turnoId', (req, res) => {
  res.json(db.prepare('SELECT * FROM tiempos_muertos WHERE turno_id=? ORDER BY hora, id').all(req.params.turnoId));
});

app.post('/api/tiempos', (req, res) => {
  const { turno_id, motivo, minutos, hora } = req.body;
  if (!turno_id || !motivo || !minutos || !hora) return res.status(400).json({ error: 'Faltan datos' });
  const r = db.prepare('INSERT INTO tiempos_muertos (turno_id, motivo, minutos, hora) VALUES (?,?,?,?)').run(turno_id, motivo, minutos, hora);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/tiempos/:id', (req, res) => {
  db.prepare('DELETE FROM tiempos_muertos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── MANAGER: REPORTES ─────────────────────────────────────────────────────────
app.get('/api/reporte/dia', (req, res) => {
  const { fecha } = req.query;
  const prod = db.prepare(`
    SELECT t.turno, m.nombre as modelo, SUM(p.cantidad) as total
    FROM produccion p
    JOIN turnos t ON p.turno_id=t.id
    JOIN modelos m ON p.modelo_id=m.id
    WHERE t.fecha=?
    GROUP BY t.turno, m.nombre ORDER BY t.turno, m.nombre
  `).all(fecha);
  const tiempos = db.prepare(`
    SELECT t.turno, tm.motivo, SUM(tm.minutos) as minutos
    FROM tiempos_muertos tm JOIN turnos t ON tm.turno_id=t.id
    WHERE t.fecha=? GROUP BY t.turno, tm.motivo ORDER BY t.turno
  `).all(fecha);
  const turnos = db.prepare("SELECT * FROM turnos WHERE fecha=? ORDER BY turno").all(fecha);
  res.json({ prod, tiempos, turnos });
});

app.get('/api/reporte/rango', (req, res) => {
  const { desde, hasta } = req.query;
  const prod = db.prepare(`
    SELECT t.fecha, t.turno, m.nombre as modelo, SUM(p.cantidad) as total
    FROM produccion p
    JOIN turnos t ON p.turno_id=t.id
    JOIN modelos m ON p.modelo_id=m.id
    WHERE t.fecha BETWEEN ? AND ?
    GROUP BY t.fecha, t.turno, m.nombre ORDER BY t.fecha DESC, t.turno, m.nombre
  `).all(desde, hasta);
  res.json(prod);
});

app.get('/api/reporte/turno/:id', (req, res) => {
  const prod = db.prepare(`
    SELECT p.hora, m.nombre as modelo, p.cantidad
    FROM produccion p JOIN modelos m ON p.modelo_id=m.id
    WHERE p.turno_id=? ORDER BY p.hora, p.id
  `).all(req.params.id);
  const tiempos = db.prepare('SELECT hora, motivo, minutos FROM tiempos_muertos WHERE turno_id=? ORDER BY hora').all(req.params.id);
  res.json({ prod, tiempos });
});

app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manager.html')));

// Servir reportes temporales
app.get('/reportes/:file', (req, res) => {
  const file = path.join(TEMP_DIR, path.basename(req.params.file));
  if (!fs.existsSync(file)) return res.status(404).send('Reporte no encontrado o expirado');
  res.download(file);
});

// ── REPORTE EXCEL ─────────────────────────────────────────────────────────────
app.post('/api/reporte/excel/:turnoId', async (req, res) => {
  const turnoId = req.params.turnoId;

  const turno = db.prepare('SELECT * FROM turnos WHERE id=?').get(turnoId);
  if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

  const prod = db.prepare(`
    SELECT p.hora, m.nombre as modelo, p.cantidad
    FROM produccion p JOIN modelos m ON p.modelo_id=m.id
    WHERE p.turno_id=? ORDER BY p.hora, m.nombre
  `).all(turnoId);

  const tiempos = db.prepare(
    'SELECT motivo, minutos, hora FROM tiempos_muertos WHERE turno_id=? ORDER BY hora'
  ).all(turnoId);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Custom Crates & Pallets';
  const ws = wb.addWorksheet('Reporte de Turno', { pageSetup: { fitToPage: true } });

  // Colores corporativos
  const ROJO    = 'FFB91C1C';
  const ROJO_LT = 'FFFEE2E2';
  const GRIS    = 'FF1E293B';
  const GRIS_LT = 'FFF1F5F9';
  const NARANJA = 'FFD97706';
  const NAR_LT  = 'FFFEF3C7';
  const BLANCO  = 'FFFFFFFF';
  const VERDE   = 'FF065F46';
  const VER_LT  = 'FFD1FAE5';

  const bold  = (sz=11) => ({ bold:true, size:sz, color:{argb:BLANCO} });
  const boldD = (sz=11) => ({ bold:true, size:sz, color:{argb:GRIS} });

  ws.columns = [
    {width:18},{width:22},{width:14},{width:14},{width:14},{width:14}
  ];

  // ── LOGO ──────────────────────────────────────────────────────────────────
  const logoPath = path.join(__dirname, 'public', 'CCP.png');
  if (fs.existsSync(logoPath)) {
    const logoId = wb.addImage({ filename: logoPath, extension: 'png' });
    ws.addImage(logoId, { tl:{col:0,row:0}, ext:{width:110,height:110} });
  }

  // ── ENCABEZADO ────────────────────────────────────────────────────────────
  ws.mergeCells('B1:F1');
  const r1 = ws.getCell('B1');
  r1.value = 'CUSTOM CRATES & PALLETS, INC.';
  r1.font = { bold:true, size:18, color:{argb:BLANCO} };
  r1.fill = { type:'pattern', pattern:'solid', fgColor:{argb:ROJO} };
  r1.alignment = { vertical:'middle', horizontal:'center' };
  ws.getRow(1).height = 38;

  ws.mergeCells('B2:F2');
  const r2 = ws.getCell('B2');
  r2.value = 'Reporte de Producción';
  r2.font = { bold:true, size:13, color:{argb:BLANCO} };
  r2.fill = { type:'pattern', pattern:'solid', fgColor:{argb:GRIS} };
  r2.alignment = { vertical:'middle', horizontal:'center' };
  ws.getRow(2).height = 26;

  ws.mergeCells('A3:C3');
  ws.getCell('A3').value = `Turno: ${turno.turno}`;
  ws.getCell('A3').font = boldD(12);
  ws.getCell('A3').fill = { type:'pattern', pattern:'solid', fgColor:{argb:GRIS_LT} };

  ws.mergeCells('D3:F3');
  const [y,m,d2] = turno.fecha.split('-');
  ws.getCell('D3').value = `Fecha: ${d2}/${m}/${y}`;
  ws.getCell('D3').font = boldD(12);
  ws.getCell('D3').fill = { type:'pattern', pattern:'solid', fgColor:{argb:GRIS_LT} };
  ws.getRow(3).height = 22;

  ws.getRow(4).height = 8;

  // ── SECCIÓN PRODUCCIÓN ────────────────────────────────────────────────────
  ws.mergeCells('A5:F5');
  const hProd = ws.getCell('A5');
  hProd.value = '📦  PRODUCCIÓN POR HORA';
  hProd.font = bold(13);
  hProd.fill = { type:'pattern', pattern:'solid', fgColor:{argb:ROJO} };
  hProd.alignment = { vertical:'middle', horizontal:'left', indent:1 };
  ws.getRow(5).height = 24;

  const prodHeader = ws.addRow(['Hora','Modelo','Cantidad']);
  prodHeader.eachCell(cell => {
    cell.font = { bold:true, size:11, color:{argb:BLANCO} };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:GRIS} };
    cell.alignment = { horizontal:'center', vertical:'middle' };
    cell.border = { bottom:{style:'thin', color:{argb:ROJO}} };
  });
  prodHeader.height = 20;

  let totalProd = 0;
  const porModelo = {};
  prod.forEach((r, i) => {
    const row = ws.addRow([r.hora, r.modelo, r.cantidad]);
    const fill = i % 2 === 0 ? BLANCO : GRIS_LT;
    row.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = { bottom:{style:'hair', color:{argb:'FFE2E8F0'}} };
    });
    row.getCell(3).numFmt = '#,##0';
    totalProd += r.cantidad;
    porModelo[r.modelo] = (porModelo[r.modelo] || 0) + r.cantidad;
  });

  if (!prod.length) {
    ws.addRow(['Sin producción registrada','','']).getCell(1).font = {italic:true, color:{argb:'FF94A3B8'}};
  }

  // Total producción
  const tProdRow = ws.addRow(['','TOTAL PRODUCCIÓN', totalProd]);
  tProdRow.eachCell(cell => {
    cell.font = { bold:true, size:11, color:{argb:BLANCO} };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:ROJO} };
    cell.alignment = { horizontal:'center', vertical:'middle' };
  });
  tProdRow.getCell(3).numFmt = '#,##0';
  tProdRow.height = 20;

  // Resumen por modelo
  ws.addRow([]);
  const modHeader = ws.addRow(['Resumen por Modelo','','Cantidad','','% del Total']);
  modHeader.eachCell((cell, col) => {
    if ([1,3,5].includes(col)) {
      cell.font = { bold:true, size:10, color:{argb:GRIS} };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:ROJO_LT} };
      cell.alignment = { horizontal:'center' };
    }
  });

  Object.entries(porModelo).sort((a,b)=>b[1]-a[1]).forEach(([ modelo, cant ], i) => {
    const pct = totalProd > 0 ? ((cant/totalProd)*100).toFixed(1)+'%' : '0%';
    const row = ws.addRow([modelo,'',cant,'',pct]);
    const fill = i % 2 === 0 ? BLANCO : ROJO_LT;
    [1,3,5].forEach(c => {
      const cell = row.getCell(c);
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      cell.alignment = { horizontal:'center' };
    });
    row.getCell(3).numFmt = '#,##0';
  });

  ws.addRow([]).height = 8;

  // ── SECCIÓN TIEMPOS MUERTOS ───────────────────────────────────────────────
  ws.mergeCells(`A${ws.rowCount+1}:F${ws.rowCount+1}`);
  const hMuerto = ws.getCell(`A${ws.rowCount}`);
  hMuerto.value = '⏸  TIEMPOS MUERTOS';
  hMuerto.font = bold(13);
  hMuerto.fill = { type:'pattern', pattern:'solid', fgColor:{argb:NARANJA} };
  hMuerto.alignment = { vertical:'middle', horizontal:'left', indent:1 };
  ws.getRow(ws.rowCount).height = 24;

  const tmHeader = ws.addRow(['Motivo','Minutos']);
  tmHeader.eachCell(cell => {
    cell.font = { bold:true, size:11, color:{argb:BLANCO} };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:GRIS} };
    cell.alignment = { horizontal:'center', vertical:'middle' };
    cell.border = { bottom:{style:'thin', color:{argb:NARANJA}} };
  });
  tmHeader.height = 20;

  let totalMin = 0;
  tiempos.forEach((r, i) => {
    const row = ws.addRow([r.motivo, r.minutos]);
    const fill = i % 2 === 0 ? BLANCO : NAR_LT;
    row.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      cell.alignment = { horizontal:'center', vertical:'middle' };
    });
    totalMin += r.minutos;
  });

  if (!tiempos.length) {
    const noTM = ws.addRow(['Sin tiempos muertos ✅','','']);
    noTM.getCell(1).font = { italic:true, color:{argb:'FF065F46'} };
    noTM.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:VER_LT} };
  }

  const tMinRow = ws.addRow(['','TOTAL TIEMPO MUERTO', totalMin + ' min']);
  tMinRow.eachCell(cell => {
    cell.font = { bold:true, size:11, color:{argb:BLANCO} };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:NARANJA} };
    cell.alignment = { horizontal:'center', vertical:'middle' };
  });
  tMinRow.height = 20;

  ws.addRow([]).height = 8;

  // ── RESUMEN FINAL ─────────────────────────────────────────────────────────
  ws.mergeCells(`A${ws.rowCount+1}:F${ws.rowCount+1}`);
  const hRes = ws.getCell(`A${ws.rowCount}`);
  hRes.value = '⚡  RESUMEN EJECUTIVO';
  hRes.font = bold(13);
  hRes.fill = { type:'pattern', pattern:'solid', fgColor:{argb:VERDE} };
  hRes.alignment = { vertical:'middle', horizontal:'left', indent:1 };
  ws.getRow(ws.rowCount).height = 24;

  const promHora = prod.length > 0
    ? Math.round(totalProd / [...new Set(prod.map(r => r.hora))].length)
    : 0;
  const eficiencia = totalMin > 0 && prod.length > 0
    ? Math.max(0, Math.round(100 - (totalMin / ([...new Set(prod.map(r=>r.hora))].length * 60)) * 100))
    : 100;

  const resData = [
    ['Total Piezas Producidas', totalProd.toLocaleString() + ' pzs'],
    ['Promedio por Hora',        promHora.toLocaleString() + ' pzs/hr'],
    ['Total Tiempo Muerto',      totalMin + ' minutos'],
    ['Eficiencia del Turno',     eficiencia + '%'],
  ];

  resData.forEach(([label, val], i) => {
    ws.mergeCells(`A${ws.rowCount+1}:D${ws.rowCount+1}`);
    ws.mergeCells(`E${ws.rowCount}:F${ws.rowCount}`);
    const row = ws.getRow(ws.rowCount);
    row.getCell(1).value = label;
    row.getCell(5).value = val;
    const fill = i % 2 === 0 ? BLANCO : VER_LT;
    [1,5].forEach(c => {
      row.getCell(c).fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      row.getCell(c).font = c===5 ? {bold:true, size:12, color:{argb:VERDE}} : {size:11};
      row.getCell(c).alignment = { vertical:'middle', horizontal: c===5?'center':'left', indent: c===1?1:0 };
    });
    row.height = 22;
  });

  // ── GRÁFICA DE LÍNEAS ─────────────────────────────────────────────────────
  ws.addRow([]).height = 8;
  ws.mergeCells(`A${ws.rowCount+1}:F${ws.rowCount+1}`);
  const hGraf = ws.getCell(`A${ws.rowCount}`);
  hGraf.value = '📈  GRÁFICA: PRODUCCIÓN vs TIEMPO MUERTO';
  hGraf.font = bold(13);
  hGraf.fill = { type:'pattern', pattern:'solid', fgColor:{argb:GRIS} };
  hGraf.alignment = { vertical:'middle', horizontal:'left', indent:1 };
  ws.getRow(ws.rowCount).height = 24;

  try {
    // Preparar datos por hora
    const porHora = {};
    prod.forEach(r => { porHora[r.hora] = (porHora[r.hora] || 0) + r.cantidad; });
    const muertosPorHora = {};
    tiempos.forEach(r => { muertosPorHora[r.hora] = (muertosPorHora[r.hora] || 0) + r.minutos; });

    const horas = [...new Set([...Object.keys(porHora), ...Object.keys(muertosPorHora)])].sort();
    const labels = horas.map(h => h.substring(0,5));
    const dataProd  = horas.map(h => porHora[h] || 0);
    const dataMuert = horas.map(h => muertosPorHora[h] || 0);

    const chartCfg = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Producción (pzs)',
            data: dataProd,
            borderColor: '#B91C1C',
            backgroundColor: 'rgba(185,28,28,0.08)',
            borderWidth: 3,
            pointRadius: 5,
            pointBackgroundColor: '#B91C1C',
            tension: 0.3,
            fill: true,
            yAxisID: 'y'
          },
          {
            label: 'Tiempo Muerto (min)',
            data: dataMuert,
            borderColor: '#D97706',
            backgroundColor: 'rgba(217,119,6,0.08)',
            borderWidth: 3,
            pointRadius: 5,
            pointBackgroundColor: '#D97706',
            tension: 0.3,
            fill: true,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'top' },
          title: { display: true, text: `Turno ${turno.turno} — ${turno.fecha}`, font: { size: 14 } }
        },
        scales: {
          y:  { position: 'left',  title: { display:true, text:'Piezas producidas' }, grid: { color:'#e2e8f0' } },
          y2: { position: 'right', title: { display:true, text:'Minutos muertos'   }, grid: { drawOnChartArea:false } }
        }
      }
    };

    const chartUrl = `https://quickchart.io/chart?w=700&h=320&bkg=white&c=${encodeURIComponent(JSON.stringify(chartCfg))}`;
    const imgBuf = await fetchBuffer(chartUrl);
    if (imgBuf.length > 1000) {
      const imgId = wb.addImage({ buffer: imgBuf, extension: 'png' });
      const startRow = ws.rowCount;
      // Reservar espacio para la imagen (aprox 18 filas)
      for (let i = 0; i < 18; i++) ws.addRow([]).height = 18;
      ws.addImage(imgId, {
        tl: { col: 0, row: startRow },
        ext: { width: 700, height: 320 }
      });
    }
  } catch (e) {
    ws.addRow(['  (Gráfica no disponible)']).getCell(1).font = { italic:true, color:{argb:'FF94A3B8'} };
  }

  // ── PIE DE PÁGINA ─────────────────────────────────────────────────────────
  ws.addRow([]).height = 8;
  ws.mergeCells(`A${ws.rowCount+1}:F${ws.rowCount+1}`);
  const pie = ws.getCell(`A${ws.rowCount}`);
  pie.value = `Generado por Sistema de Producción Clavadora · ${new Date().toLocaleString('es-MX')}`;
  pie.font = { italic:true, size:9, color:{argb:'FF94A3B8'} };
  pie.alignment = { horizontal:'center' };

  const fecha = turno.fecha.replace(/-/g,'');
  const uid = crypto.randomUUID().substring(0, 8);
  const filename = `Reporte_${turno.turno}_${fecha}_${uid}.xlsx`;
  const filepath = path.join(TEMP_DIR, filename);

  await wb.xlsx.writeFile(filepath);

  // Borrar el archivo después de 2 horas
  setTimeout(() => fs.unlink(filepath, () => {}), 2 * 60 * 60 * 1000);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${baseUrl}/reportes/${filename}`, filename });
});

app.listen(PORT, '0.0.0.0', () => console.log(`http://localhost:${PORT}`));
