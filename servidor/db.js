/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/db.js
 * Tipo:     JavaScript (Node.js · SQLite)
 * Capa:     Capa de datos
 * Qué hace: Base de datos SQLite: tablas, migración automática y todas las consultas con
 *           parámetros.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS clientes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    correo     TEXT NOT NULL UNIQUE,
    nombre     TEXT NOT NULL,
    clave_hash TEXT NOT NULL,
    creado     TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario    TEXT NOT NULL UNIQUE,
    nombre     TEXT NOT NULL,
    rol        TEXT NOT NULL CHECK (rol IN ('admin', 'operador')),
    clave_hash TEXT NOT NULL,
    creado     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sesiones (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sesiones_clientes (
    token_hash TEXT PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    expira     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contactos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    nombre     TEXT NOT NULL,
    telefono   TEXT NOT NULL,
    relacion   TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS respuestas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alerta_id  INTEGER NOT NULL REFERENCES alertas(id),
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    estado     TEXT NOT NULL CHECK (estado IN ('bien', 'ayuda')),
    fecha      TEXT NOT NULL,
    UNIQUE (alerta_id, cliente_id)
  );
`;

// Columnas que se agregaron después de la primera versión. Si una base de datos vieja
// no las tiene, se crean sin perder los datos (migración).
const COLUMNAS_NUEVAS = {
  dispositivos: {
    cliente_id: 'INTEGER REFERENCES clientes(id)',
    codigo_hash: 'TEXT',
    umbral: 'REAL NOT NULL DEFAULT 0.15',
    direccion: "TEXT NOT NULL DEFAULT ''",
  },
  respuestas: {
    atendida: 'INTEGER NOT NULL DEFAULT 0',
    atendida_por: 'TEXT',
    atendida_fecha: 'TEXT',
  },
};

function migrar(db) {
  for (const [tabla, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
    const existentes = new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
    for (const [nombre, tipo] of Object.entries(columnas)) {
      if (!existentes.has(nombre)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo}`);
    }
  }
}

/** Abre (o crea) la base de datos. Usa ':memory:' en las pruebas. */
function abrirBaseDatos(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  if (ruta !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  migrar(db);

  // Todas las consultas usan parámetros (?) para evitar inyección SQL.
  const q = {
    // dispositivos
    guardarDispositivo: db.prepare(`
      INSERT INTO dispositivos (id, nombre, ciudad, lat, lon, token_hash, codigo_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ciudad = excluded.ciudad, lat = excluded.lat, lon = excluded.lon,
        token_hash = excluded.token_hash, codigo_hash = excluded.codigo_hash`),
    listarDispositivos: db.prepare('SELECT * FROM dispositivos ORDER BY ciudad, nombre'),
    obtenerDispositivo: db.prepare('SELECT * FROM dispositivos WHERE id = ?'),
    dispositivoPorCodigo: db.prepare('SELECT * FROM dispositivos WHERE codigo_hash = ?'),
    dispositivosDeCliente: db.prepare('SELECT * FROM dispositivos WHERE cliente_id = ? ORDER BY nombre'),
    vincular: db.prepare('UPDATE dispositivos SET cliente_id = ? WHERE id = ? AND cliente_id IS NULL'),
    ajustarDispositivo: db.prepare('UPDATE dispositivos SET nombre = ?, direccion = ?, umbral = ? WHERE id = ? AND cliente_id = ?'),
    marcarConexion: db.prepare('UPDATE dispositivos SET ultima_conexion = ? WHERE id = ?'),
    // eventos y alertas
    guardarEvento: db.prepare('INSERT INTO eventos (dispositivo_id, fecha, pga) VALUES (?, ?, ?)'),
    ultimosEventos: db.prepare(`
      SELECT e.id, e.dispositivo_id, d.nombre, d.ciudad, e.fecha, e.pga
      FROM eventos e JOIN dispositivos d ON d.id = e.dispositivo_id
      ORDER BY e.id DESC LIMIT ?`),
    eventosDeCliente: db.prepare(`
      SELECT e.id, e.dispositivo_id, d.nombre, d.ciudad, e.fecha, e.pga
      FROM eventos e JOIN dispositivos d ON d.id = e.dispositivo_id
      WHERE d.cliente_id = ? ORDER BY e.id DESC LIMIT ?`),
    guardarAlerta: db.prepare('INSERT INTO alertas (fecha, lat, lon, dispositivos, pga_max) VALUES (?, ?, ?, ?, ?)'),
    actualizarAlerta: db.prepare('UPDATE alertas SET dispositivos = ?, pga_max = ? WHERE id = ?'),
    obtenerAlerta: db.prepare('SELECT * FROM alertas WHERE id = ?'),
    ultimasAlertas: db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM respuestas r WHERE r.alerta_id = a.id AND r.estado = 'bien')  AS bien,
        (SELECT COUNT(*) FROM respuestas r WHERE r.alerta_id = a.id AND r.estado = 'ayuda') AS ayuda
      FROM alertas a ORDER BY a.id DESC LIMIT ?`),
    // usuarios del panel
    guardarUsuario: db.prepare(`
      INSERT INTO usuarios (usuario, nombre, rol, clave_hash, creado) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(usuario) DO UPDATE SET nombre = excluded.nombre, rol = excluded.rol, clave_hash = excluded.clave_hash`),
    buscarUsuario: db.prepare('SELECT * FROM usuarios WHERE usuario = ?'),
    contarUsuarios: db.prepare('SELECT COUNT(*) AS n FROM usuarios'),
    crearSesion: db.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, ?)'),
    buscarSesion: db.prepare(`
      SELECT u.id, u.usuario, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira > ?`),
    borrarSesion: db.prepare('DELETE FROM sesiones WHERE token_hash = ?'),
    borrarSesionesUsuario: db.prepare('DELETE FROM sesiones WHERE usuario_id = ?'),
    // clientes
    crearCliente: db.prepare('INSERT INTO clientes (correo, nombre, clave_hash, creado) VALUES (?, ?, ?, ?)'),
    buscarCliente: db.prepare('SELECT * FROM clientes WHERE correo = ?'),
    crearSesionCliente: db.prepare('INSERT INTO sesiones_clientes (token_hash, cliente_id, expira) VALUES (?, ?, ?)'),
    buscarSesionCliente: db.prepare(`
      SELECT c.id, c.correo, c.nombre FROM sesiones_clientes s JOIN clientes c ON c.id = s.cliente_id
      WHERE s.token_hash = ? AND s.expira > ?`),
    borrarSesionCliente: db.prepare('DELETE FROM sesiones_clientes WHERE token_hash = ?'),
    borrarSesionesVencidas: db.prepare('DELETE FROM sesiones WHERE expira <= ?'),
    borrarSesionesClientesVencidas: db.prepare('DELETE FROM sesiones_clientes WHERE expira <= ?'),
    // contactos de emergencia
    listarContactos: db.prepare('SELECT id, nombre, telefono, relacion FROM contactos WHERE cliente_id = ? ORDER BY id'),
    agregarContacto: db.prepare('INSERT INTO contactos (cliente_id, nombre, telefono, relacion) VALUES (?, ?, ?, ?)'),
    borrarContacto: db.prepare('DELETE FROM contactos WHERE id = ? AND cliente_id = ?'),
    // respuestas «Estoy bien / Necesito ayuda»
    guardarRespuesta: db.prepare(`
      INSERT INTO respuestas (alerta_id, cliente_id, estado, fecha) VALUES (?, ?, ?, ?)
      ON CONFLICT(alerta_id, cliente_id) DO UPDATE SET estado = excluded.estado, fecha = excluded.fecha`),
    respuestaDeCliente: db.prepare('SELECT estado FROM respuestas WHERE alerta_id = ? AND cliente_id = ?'),
    conteoRespuestas: db.prepare(`
      SELECT SUM(estado = 'bien') AS bien, SUM(estado = 'ayuda') AS ayuda FROM respuestas WHERE alerta_id = ?`),
    // gestión desde el panel de la empresa
    ciudades: db.prepare('SELECT DISTINCT ciudad FROM dispositivos ORDER BY ciudad'),
    clientesResumen: db.prepare(`
      SELECT c.id, c.nombre, c.correo, c.creado,
        (SELECT COUNT(*) FROM dispositivos d WHERE d.cliente_id = c.id) AS dispositivos,
        (SELECT COUNT(*) FROM contactos k WHERE k.cliente_id = c.id) AS contactos
      FROM clientes c ORDER BY c.creado DESC`),
    desvincular: db.prepare("UPDATE dispositivos SET cliente_id = NULL, umbral = 0.15, direccion = '' WHERE id = ? AND cliente_id IS NOT NULL"),
    solicitudesAyuda: db.prepare(`
      SELECT r.id, r.alerta_id, r.fecha, r.atendida, r.atendida_por, r.atendida_fecha, c.id AS cliente_id, c.nombre, c.correo
      FROM respuestas r JOIN clientes c ON c.id = r.cliente_id
      WHERE r.estado = 'ayuda' ORDER BY r.atendida, r.fecha DESC LIMIT ?`),
    atenderSolicitud: db.prepare("UPDATE respuestas SET atendida = 1, atendida_por = ?, atendida_fecha = ? WHERE id = ? AND estado = 'ayuda' AND atendida = 0"),
    pendientesAyuda: db.prepare("SELECT COUNT(*) AS n FROM respuestas WHERE estado = 'ayuda' AND atendida = 0"),
  };

  /**
   * Historial consultable (RF04). Los filtros se agregan como parámetros (?), nunca
   * concatenando texto del usuario en la consulta.
   */
  function historial(tipo, f, limite, desplazamiento) {
    const cond = [], params = [];
    if (tipo === 'alertas') {
      if (f.desde) { cond.push('a.fecha >= ?'); params.push(f.desde); }
      if (f.hasta) { cond.push('a.fecha < ?'); params.push(f.hasta); }
      if (f.min != null) { cond.push('a.pga_max >= ?'); params.push(f.min); }
      const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM alertas a ${donde}`).get(...params).n;
      const items = db.prepare(`
        SELECT a.*,
          (SELECT COUNT(*) FROM respuestas r WHERE r.alerta_id = a.id AND r.estado = 'bien')  AS bien,
          (SELECT COUNT(*) FROM respuestas r WHERE r.alerta_id = a.id AND r.estado = 'ayuda') AS ayuda
        FROM alertas a ${donde} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, limite, desplazamiento);
      return { total, items };
    }
    if (f.desde) { cond.push('e.fecha >= ?'); params.push(f.desde); }
    if (f.hasta) { cond.push('e.fecha < ?'); params.push(f.hasta); }
    if (f.ciudad) { cond.push('d.ciudad = ?'); params.push(f.ciudad); }
    if (f.min != null) { cond.push('e.pga >= ?'); params.push(f.min); }
    const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const desde = 'FROM eventos e JOIN dispositivos d ON d.id = e.dispositivo_id';
    const total = db.prepare(`SELECT COUNT(*) AS n ${desde} ${donde}`).get(...params).n;
    const items = db.prepare(`
      SELECT e.id, e.dispositivo_id, d.nombre, d.ciudad, e.fecha, e.pga ${desde} ${donde}
      ORDER BY e.id DESC LIMIT ? OFFSET ?`).all(...params, limite, desplazamiento);
    return { total, items };
  }

  return {
    // dispositivos
    guardarDispositivo: (d) => q.guardarDispositivo.run(d.id, d.nombre, d.ciudad, d.lat, d.lon, d.token_hash, d.codigo_hash ?? null),
    listarDispositivos: () => q.listarDispositivos.all(),
    obtenerDispositivo: (id) => q.obtenerDispositivo.get(id),
    dispositivoPorCodigo: (codigoHash) => q.dispositivoPorCodigo.get(codigoHash),
    dispositivosDeCliente: (clienteId) => q.dispositivosDeCliente.all(clienteId),
    vincularDispositivo: (id, clienteId) => q.vincular.run(clienteId, id).changes === 1,
    ajustarDispositivo: (id, clienteId, a) => q.ajustarDispositivo.run(a.nombre, a.direccion, a.umbral, id, clienteId).changes === 1,
    marcarConexion: (id, fecha) => q.marcarConexion.run(fecha, id),
    // eventos y alertas
    guardarEvento: (e) => Number(q.guardarEvento.run(e.dispositivo_id, e.fecha, e.pga).lastInsertRowid),
    ultimosEventos: (n = 20) => q.ultimosEventos.all(n),
    eventosDeCliente: (clienteId, n = 30) => q.eventosDeCliente.all(clienteId, n),
    guardarAlerta: (a) => Number(q.guardarAlerta.run(a.fecha, a.lat, a.lon, a.dispositivos, a.pga_max).lastInsertRowid),
    actualizarAlerta: (id, dispositivos, pgaMax) => q.actualizarAlerta.run(dispositivos, pgaMax, id),
    obtenerAlerta: (id) => q.obtenerAlerta.get(id),
    ultimasAlertas: (n = 10) => q.ultimasAlertas.all(n),
    // usuarios del panel
    guardarUsuario: (u) => q.guardarUsuario.run(u.usuario, u.nombre, u.rol, u.clave_hash, new Date().toISOString()),
    buscarUsuario: (usuario) => q.buscarUsuario.get(usuario),
    contarUsuarios: () => q.contarUsuarios.get().n,
    crearSesion: (tokenHash, usuarioId, expira) => q.crearSesion.run(tokenHash, usuarioId, expira),
    buscarSesion: (tokenHash, ahora) => q.buscarSesion.get(tokenHash, ahora),
    borrarSesion: (tokenHash) => q.borrarSesion.run(tokenHash),
    borrarSesionesUsuario: (usuarioId) => q.borrarSesionesUsuario.run(usuarioId),
    borrarSesionesVencidas: (ahora) => { q.borrarSesionesVencidas.run(ahora); q.borrarSesionesClientesVencidas.run(ahora); },
    // clientes
    crearCliente: (c) => Number(q.crearCliente.run(c.correo, c.nombre, c.clave_hash, new Date().toISOString()).lastInsertRowid),
    buscarCliente: (correo) => q.buscarCliente.get(correo),
    crearSesionCliente: (tokenHash, clienteId, expira) => q.crearSesionCliente.run(tokenHash, clienteId, expira),
    buscarSesionCliente: (tokenHash, ahora) => q.buscarSesionCliente.get(tokenHash, ahora),
    borrarSesionCliente: (tokenHash) => q.borrarSesionCliente.run(tokenHash),
    // contactos
    listarContactos: (clienteId) => q.listarContactos.all(clienteId),
    agregarContacto: (clienteId, c) => Number(q.agregarContacto.run(clienteId, c.nombre, c.telefono, c.relacion).lastInsertRowid),
    borrarContacto: (id, clienteId) => q.borrarContacto.run(id, clienteId).changes === 1,
    // respuestas
    guardarRespuesta: (alertaId, clienteId, estado) => q.guardarRespuesta.run(alertaId, clienteId, estado, new Date().toISOString()),
    respuestaDeCliente: (alertaId, clienteId) => q.respuestaDeCliente.get(alertaId, clienteId)?.estado ?? null,
    conteoRespuestas: (alertaId) => { const r = q.conteoRespuestas.get(alertaId); return { bien: r.bien || 0, ayuda: r.ayuda || 0 }; },
    // gestión desde el panel
    historial,
    ciudades: () => q.ciudades.all().map((r) => r.ciudad),
    clientesResumen: () => q.clientesResumen.all(),
    desvincularDispositivo: (id) => q.desvincular.run(id).changes === 1,
    solicitudesAyuda: (n = 50) => q.solicitudesAyuda.all(n),
    atenderSolicitud: (id, usuario) => q.atenderSolicitud.run(usuario, new Date().toISOString(), id).changes === 1,
    pendientesAyuda: () => q.pendientesAyuda.get().n,
    cerrar: () => db.close(),
  };
}

module.exports = { abrirBaseDatos };
