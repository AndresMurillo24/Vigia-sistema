'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS dispositivos (
    id              TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    ciudad          TEXT NOT NULL,
    lat             REAL NOT NULL,
    lon             REAL NOT NULL,
    token_hash      TEXT NOT NULL,
    ultima_conexion TEXT
  );
  CREATE TABLE IF NOT EXISTS eventos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dispositivo_id TEXT NOT NULL REFERENCES dispositivos(id),
    fecha          TEXT NOT NULL,
    pga            REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alertas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha        TEXT NOT NULL,
    lat          REAL NOT NULL,
    lon          REAL NOT NULL,
    dispositivos INTEGER NOT NULL,
    pga_max      REAL NOT NULL
  );
`;

/** Abre (o crea) la base de datos. Usa ':memory:' en las pruebas. */
function abrirBaseDatos(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  if (ruta !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);

  // Todas las consultas usan parámetros (?) para evitar inyección SQL.
  const q = {
    guardarDispositivo: db.prepare(`
      INSERT INTO dispositivos (id, nombre, ciudad, lat, lon, token_hash) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, ciudad = excluded.ciudad,
        lat = excluded.lat, lon = excluded.lon, token_hash = excluded.token_hash`),
    listarDispositivos: db.prepare('SELECT * FROM dispositivos ORDER BY ciudad, nombre'),
    marcarConexion: db.prepare('UPDATE dispositivos SET ultima_conexion = ? WHERE id = ?'),
    guardarEvento: db.prepare('INSERT INTO eventos (dispositivo_id, fecha, pga) VALUES (?, ?, ?)'),
    ultimosEventos: db.prepare(`
      SELECT e.id, e.dispositivo_id, d.nombre, d.ciudad, e.fecha, e.pga
      FROM eventos e JOIN dispositivos d ON d.id = e.dispositivo_id
      ORDER BY e.id DESC LIMIT ?`),
    guardarAlerta: db.prepare('INSERT INTO alertas (fecha, lat, lon, dispositivos, pga_max) VALUES (?, ?, ?, ?, ?)'),
    actualizarAlerta: db.prepare('UPDATE alertas SET dispositivos = ?, pga_max = ? WHERE id = ?'),
    ultimasAlertas: db.prepare('SELECT * FROM alertas ORDER BY id DESC LIMIT ?'),
  };

  return {
    guardarDispositivo: (d) => q.guardarDispositivo.run(d.id, d.nombre, d.ciudad, d.lat, d.lon, d.token_hash),
    listarDispositivos: () => q.listarDispositivos.all(),
    marcarConexion: (id, fecha) => q.marcarConexion.run(fecha, id),
    guardarEvento: (e) => Number(q.guardarEvento.run(e.dispositivo_id, e.fecha, e.pga).lastInsertRowid),
    ultimosEventos: (n = 20) => q.ultimosEventos.all(n),
    guardarAlerta: (a) => Number(q.guardarAlerta.run(a.fecha, a.lat, a.lon, a.dispositivos, a.pga_max).lastInsertRowid),
    actualizarAlerta: (id, dispositivos, pgaMax) => q.actualizarAlerta.run(dispositivos, pgaMax, id),
    ultimasAlertas: (n = 10) => q.ultimasAlertas.all(n),
    cerrar: () => db.close(),
  };
}

module.exports = { abrirBaseDatos };
