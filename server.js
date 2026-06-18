const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

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

app.listen(PORT, '0.0.0.0', () => console.log(`http://localhost:${PORT}`));
