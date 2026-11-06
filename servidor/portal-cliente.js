/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/portal-cliente.js
 * Tipo:     JavaScript (Node.js · Express + WebSocket)
 * Capa:     Capa de backend y comunicación
 * Qué hace: API y canal en vivo de la app del cliente; cada hogar solo accede a sus propios
 *           dispositivos.
 */
'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { crearAutenticacion } = require('./auth');
const { hashClave, hashToken } = require('./seguridad');
const { distanciaKm } = require('../compartido/geo');
const v = require('./validacion');

const MAX_CONTACTOS = 5;
const MAX_INTENTOS_CODIGO = 10; // por cuenta y por hora, para que no se puedan adivinar códigos

/**
 * Portal de los clientes («Mi Vigía»): cada hogar ve y configura solo SUS dispositivos.
 *
 * Regla de seguridad principal: toda consulta o cambio filtra por el cliente de la sesión
 * (cliente_id). Así un cliente no puede ver ni modificar el dispositivo de otro cambiando
 * un identificador en la URL (vulnerabilidad IDOR).
 */
function crearPortalCliente({ app, db, config, log, estado, enviarADispositivo, avisarPanel }) {
  const auth = crearAutenticacion({
    config, log,
    cookie: 'vigia_cliente',
    campo: 'cliente',
    almacen: { buscar: db.buscarCliente, crearSesion: db.crearSesionCliente, buscarSesion: db.buscarSesionCliente, borrarSesion: db.borrarSesionCliente },
    validar: v.validarLoginCliente,
    publico: (c) => ({ nombre: c.nombre, correo: c.correo }),
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const intentosCodigo = new Map(); // clienteId -> { n, desde }

  /* ---------- utilidades ---------- */
  const vista = (e) => ({
    id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, direccion: e.d.direccion, umbral: e.d.umbral,
    enLinea: e.enLinea, enAlerta: Date.now() < e.alertaHasta, bateria: e.bateria ?? null, wifi: e.wifi ?? null,
  });
  const propios = (clienteId) => [...estado.values()].filter((e) => e.d.cliente_id === clienteId);
  const refrescar = (id) => { const e = estado.get(id); if (e) e.d = db.obtenerDispositivo(id); return e; };
  function enviarCliente(clienteId, mensaje) {
    const texto = JSON.stringify(mensaje);
    for (const ws of wss.clients) if (ws.clienteId === clienteId && ws.readyState === WebSocket.OPEN) ws.send(texto);
  }
  function alertaParaCliente(a, clienteId) {
    const casas = propios(clienteId);
    const cercana = casas.map((e) => ({ e, d: distanciaKm(e.d, a) })).sort((x, y) => x.d - y.d)[0];
    return {
      id: a.id, fecha: a.fecha, lat: a.lat, lon: a.lon,
      distanciaKm: cercana ? Math.round(cercana.d) : null,
      dispositivo: cercana ? cercana.e.d.nombre : null,
      respuesta: db.respuestaDeCliente(a.id, clienteId),
    };
  }
  /** Busca un dispositivo del cliente; si no es suyo responde 404 (no revela que existe). */
  function dispositivoPropio(req, res) {
    const e = estado.get(req.params.id);
    if (!e || e.d.cliente_id !== req.cuenta.id) { res.status(404).json({ error: 'Dispositivo no encontrado' }); return null; }
    return e;
  }

  /* ---------- cuenta ---------- */
  app.post('/api/cliente/registro', (req, res) => {
    const r = v.validarRegistro(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    if (db.buscarCliente(r.datos.correo)) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
    const id = db.crearCliente({ correo: r.datos.correo, nombre: r.datos.nombre, clave_hash: hashClave(r.datos.clave) });
    auth.abrirSesion(req, res, { id });
    log(`[CLIENTE] Nueva cuenta: ${r.datos.correo}`);
    res.status(201).json({ cliente: { nombre: r.datos.nombre, correo: r.datos.correo } });
  });
  app.post('/api/cliente/login', auth.login);
  app.post('/api/cliente/logout', (req, res) => {
    const c = auth.logout(req, res);
    if (c) for (const ws of wss.clients) if (ws.tokenHash === c.tokenHash) ws.close(4401, 'Sesión cerrada');
  });

  /* ---------- resumen para la pantalla de inicio ---------- */
  app.get('/api/cliente/resumen', auth.requerir(), (req, res) => {
    const id = req.cuenta.id;
    res.json({
      cliente: { nombre: req.cuenta.nombre, correo: req.cuenta.correo },
      dispositivos: propios(id).map(vista),
      contactos: db.listarContactos(id),
      eventos: db.eventosDeCliente(id, 30),
      alertas: db.ultimasAlertas(10).map((a) => alertaParaCliente(a, id)),
      limites: { umbralMin: v.UMBRAL_MIN, umbralMax: v.UMBRAL_MAX },
    });
  });

  /* ---------- vincular un dispositivo con el código de la caja ---------- */
  app.post('/api/cliente/vincular', auth.requerir(), (req, res) => {
    const id = req.cuenta.id;
    const intento = intentosCodigo.get(id) || { n: 0, desde: Date.now() };
    if (Date.now() - intento.desde > 3_600_000) Object.assign(intento, { n: 0, desde: Date.now() });
    if (intento.n >= MAX_INTENTOS_CODIGO) return res.status(429).json({ error: 'Demasiados códigos incorrectos. Intenta de nuevo en una hora.' });

    const r = v.validarCodigo(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    const d = db.dispositivoPorCodigo(hashToken(r.datos.codigo));
    if (!d) {
      intento.n++; intentosCodigo.set(id, intento);
      return res.status(404).json({ error: 'No encontramos un dispositivo con ese código' });
    }
    if (d.cliente_id && d.cliente_id !== id) return res.status(409).json({ error: 'Este dispositivo ya está vinculado a otra cuenta' });
    if (!d.cliente_id) db.vincularDispositivo(d.id, id);
    const e = refrescar(d.id);
    log(`[CLIENTE] ${req.cuenta.correo} vinculó ${d.nombre}`);
    res.json({ dispositivo: vista(e) });
  });

  /* ---------- ajustes del dispositivo (RF06) ---------- */
  app.patch('/api/cliente/dispositivos/:id', auth.requerir(), (req, res) => {
    const e = dispositivoPropio(req, res);
    if (!e) return;
    const r = v.validarAjustes(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    const umbralAnterior = e.d.umbral;
    db.ajustarDispositivo(e.d.id, req.cuenta.id, r.datos);
    refrescar(e.d.id);
    // El nuevo umbral se envía al dispositivo: la detección local usa el valor del usuario.
    if (r.datos.umbral !== umbralAnterior) enviarADispositivo(e.d.id, { tipo: 'config', umbral: r.datos.umbral });
    res.json({ dispositivo: vista(e) });
  });

  app.post('/api/cliente/dispositivos/:id/prueba', auth.requerir(), (req, res) => {
    const e = dispositivoPropio(req, res);
    if (!e) return;
    if (!e.enLinea) return res.status(409).json({ error: 'El dispositivo no está conectado' });
    enviarADispositivo(e.d.id, { tipo: 'prueba' });
    res.status(202).json({ ok: true });
  });

  /* ---------- contactos de emergencia ---------- */
  app.post('/api/cliente/contactos', auth.requerir(), (req, res) => {
    const r = v.validarContacto(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    if (db.listarContactos(req.cuenta.id).length >= MAX_CONTACTOS) return res.status(409).json({ error: `Puedes tener hasta ${MAX_CONTACTOS} contactos` });
    const id = db.agregarContacto(req.cuenta.id, r.datos);
    res.status(201).json({ contacto: { id, ...r.datos } });
  });
  app.delete('/api/cliente/contactos/:id', auth.requerir(), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !db.borrarContacto(id, req.cuenta.id)) return res.status(404).json({ error: 'Contacto no encontrado' });
    res.status(204).end();
  });

  /* ---------- «Estoy bien» / «Necesito ayuda» después de una alerta ---------- */
  app.post('/api/cliente/respuestas', auth.requerir(), (req, res) => {
    const r = v.validarRespuesta(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    if (!db.obtenerAlerta(r.datos.alertaId)) return res.status(404).json({ error: 'Alerta no encontrada' });
    db.guardarRespuesta(r.datos.alertaId, req.cuenta.id, r.datos.estado);
    const conteo = db.conteoRespuestas(r.datos.alertaId);
    log(`[CLIENTE] ${req.cuenta.correo} respondió «${r.datos.estado}» a la alerta ${r.datos.alertaId}`);
    avisarPanel({ tipo: 'respuesta', alertaId: r.datos.alertaId, ...conteo });
    res.json({ ok: true, conteo });
  });

  /* ---------- canal en vivo /ws/cliente ---------- */
  function aceptarConexion(req, socket, head) {
    const c = auth.cuentaDeRequest(req);
    if (!c) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => { ws.clienteId = c.id; ws.tokenHash = c.tokenHash; });
  }

  /* ---------- avisos que dispara el resto de la plataforma ---------- */
  return {
    aceptarConexion,
    alDispositivo: (e) => { if (e.d.cliente_id) enviarCliente(e.d.cliente_id, { tipo: 'dispositivo', dispositivo: vista(e) }); },
    alEvento: (e, evento) => { if (e.d.cliente_id) enviarCliente(e.d.cliente_id, { tipo: 'evento', evento, dispositivo: vista(e) }); },
    alPrueba: (e) => { if (e.d.cliente_id) enviarCliente(e.d.cliente_id, { tipo: 'prueba_ok', id: e.d.id }); },
    alAlerta: (a) => {
      const clientes = new Set([...wss.clients].map((ws) => ws.clienteId));
      for (const id of clientes) enviarCliente(id, { tipo: 'alerta', alerta: alertaParaCliente(a, id) });
    },
    /** lecturas: [{ id, m, alerta }] de todos los dispositivos; cada cliente recibe solo las suyas. */
    alLecturas: (lecturas) => {
      if (wss.clients.size === 0) return;
      const porCliente = new Map();
      for (const l of lecturas) {
        const dueno = estado.get(l.id)?.d.cliente_id;
        if (!dueno) continue;
        if (!porCliente.has(dueno)) porCliente.set(dueno, []);
        porCliente.get(dueno).push({ id: l.id, m: l.m, alerta: l.alerta });
      }
      for (const [id, datos] of porCliente) enviarCliente(id, { tipo: 'lecturas', datos });
    },
    cerrar: () => { for (const ws of wss.clients) ws.terminate(); },
  };
}

module.exports = { crearPortalCliente };
