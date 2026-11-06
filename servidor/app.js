'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { Detector } = require('./detector');
const { validarMensajeDispositivo, validarSimulacion } = require('./validacion');
const { verificarToken } = require('./seguridad');
const { autenticacionPanel } = require('./auth');
const { crearPortalCliente } = require('./portal-cliente');

const INTERVALO_LECTURAS_MS = 200; // cada cuánto se envían las lecturas agrupadas a las pantallas
const TIEMPO_AUTENTICACION_MS = 5000;

/**
 * Crea la plataforma central: API REST, panel de la empresa, portal de los clientes y los
 * canales WebSocket (/ws/dispositivo, /ws/panel y /ws/cliente).
 */
function crearServidor({ db, config, log = console.log }) {
  const auth = autenticacionPanel({ db, config, log });

  /* ---------- estado en memoria de cada dispositivo ---------- */
  const estado = new Map();
  for (const d of db.listarDispositivos()) {
    estado.set(d.id, { d, socket: null, enLinea: false, alertaHasta: 0, ultima: null, pico: 0, bateria: null, wifi: null });
  }
  const resumen = (e) => ({
    id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, lat: e.d.lat, lon: e.d.lon,
    enLinea: e.enLinea, enAlerta: Date.now() < e.alertaHasta, cliente: !!e.d.cliente_id,
  });

  /* ---------- HTTP ---------- */
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '10kb' }));
  // Las peticiones que modifican algo deben ser JSON: un formulario de otro sitio no puede enviarlas.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Se esperaba JSON' });
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));
  app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

  const server = http.createServer(app);
  const wssDispositivos = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const wssPanel = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  function enviarADispositivo(id, mensaje) {
    const e = estado.get(id);
    if (e?.socket) enviar(e.socket, mensaje);
  }

  /* ---------- portal de los clientes ---------- */
  const portal = crearPortalCliente({
    app, db, config, log, estado, enviarADispositivo,
    avisarPanel: (m) => difundir(wssPanel, m),
  });

  /* ---------- detector de sismos ---------- */
  const detector = new Detector({
    ventanaMs: config.VENTANA_CONFIRMACION_MS,
    minDispositivos: config.MIN_DISPOSITIVOS,
    radioKm: config.RADIO_KM,
  });
  const idsAlerta = new Map(); // id del detector -> id en la base de datos

  detector.on('alerta', (a) => {
    const fecha = new Date(a.t).toISOString();
    const id = db.guardarAlerta({ fecha, lat: a.lat, lon: a.lon, dispositivos: a.dispositivos.length, pga_max: a.pgaMax });
    idsAlerta.set(a.id, id);
    const alerta = { id, fecha, lat: a.lat, lon: a.lon, dispositivos: a.dispositivos.length, pga_max: a.pgaMax, bien: 0, ayuda: 0 };
    log(`[ALERTA] Sismo confirmado por ${a.dispositivos.length} dispositivos · PGA máx ${a.pgaMax.toFixed(2)} g`);
    difundir(wssPanel, { tipo: 'alerta', alerta });
    // Aviso temprano: todos los dispositivos de la red y las apps de los clientes reciben la alerta.
    difundir(wssDispositivos, { tipo: 'alerta', alerta: { lat: a.lat, lon: a.lon, t: a.t } });
    portal.alAlerta(alerta);
  });
  detector.on('actualizacion', (a) => {
    const id = idsAlerta.get(a.id);
    db.actualizarAlerta(id, a.dispositivos.length, a.pgaMax);
    difundir(wssPanel, { tipo: 'alerta_actualizada', alerta: { id, dispositivos: a.dispositivos.length, pga_max: a.pgaMax } });
  });

  /* ---------- API del panel de la empresa ---------- */
  app.post('/api/login', auth.login);
  app.post('/api/logout', (req, res) => {
    const u = auth.logout(req, res);
    if (u) for (const ws of wssPanel.clients) if (ws.tokenHash === u.tokenHash) ws.close(4401, 'Sesión cerrada');
  });
  app.get('/api/sesion', auth.requerir(), (req, res) => {
    const { usuario, nombre, rol } = req.cuenta;
    res.json({ usuario: { usuario, nombre, rol } });
  });
  app.get('/api/estado', auth.requerir(), (req, res) => {
    res.json({
      dispositivos: [...estado.values()].map(resumen),
      eventos: db.ultimosEventos(20),
      alertas: db.ultimasAlertas(10),
      config: { umbral: config.UMBRAL_G, modoSimulacion: config.MODO_SIMULACION },
    });
  });
  // Solo un administrador puede ordenar una simulación.
  app.post('/api/simulacion', auth.requerir('admin'), (req, res) => {
    if (!config.MODO_SIMULACION) return res.status(403).json({ error: 'El modo simulación está desactivado' });
    const v = validarSimulacion(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const orden = { tipo: 'simular_sismo', ...v.datos, inicio: Date.now() };
    const enviados = difundir(wssDispositivos, orden);
    log(`[SIMULACIÓN] ${req.cuenta.usuario} envió un sismo M${v.datos.magnitud} en (${v.datos.lat}, ${v.datos.lon}) a ${enviados} dispositivos`);
    res.status(202).json({ enviados });
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    log('[ERROR]', err);
    res.status(500).json({ error: 'Error interno' });
  });

  /* ---------- WebSocket ---------- */
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/ws/cliente') return portal.aceptarConexion(req, socket, head);
    if (pathname === '/ws/dispositivo') {
      return wssDispositivos.handleUpgrade(req, socket, head, (ws) => wssDispositivos.emit('connection', ws, req));
    }
    if (pathname === '/ws/panel') {
      // El panel solo recibe datos en vivo si quien lo abre tiene una sesión válida.
      const usuario = auth.cuentaDeRequest(req);
      if (!usuario) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
      }
      return wssPanel.handleUpgrade(req, socket, head, (ws) => { ws.tokenHash = usuario.tokenHash; });
    }
    socket.destroy();
  });

  wssDispositivos.on('connection', (ws) => {
    let id = null;
    const limite = setTimeout(() => ws.close(4001, 'Sin autenticación'), TIEMPO_AUTENTICACION_MS);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return ws.close(4002, 'JSON inválido'); }
      const v = validarMensajeDispositivo(msg);
      if (!v.ok) return id ? enviar(ws, { tipo: 'error', error: v.error }) : ws.close(4002, v.error);
      const m = v.datos;

      if (!id) {
        if (m.tipo !== 'hola') return ws.close(4001, 'Primero debe autenticarse');
        const e = estado.get(m.id);
        if (!e || !verificarToken(m.token, e.d.token_hash)) return ws.close(4003, 'Credenciales inválidas');
        clearTimeout(limite);
        id = m.id;
        if (e.socket && e.socket !== ws) e.socket.close(4004, 'Reemplazado por una nueva conexión');
        e.socket = ws;
        e.enLinea = true;
        db.marcarConexion(id, new Date().toISOString());
        // Cada dispositivo trabaja con el umbral que eligió su dueño en la app.
        enviar(ws, { tipo: 'bienvenida', umbral: e.d.umbral ?? config.UMBRAL_G });
        difundir(wssPanel, { tipo: 'dispositivo', dispositivo: resumen(e) });
        portal.alDispositivo(e);
        return;
      }

      const e = estado.get(id);
      switch (m.tipo) {
        case 'lectura': {
          const magnitud = Math.hypot(m.x, m.y, m.z);
          e.ultima = { x: m.x, y: m.y, z: m.z, m: magnitud };
          e.pico = Math.max(e.pico, magnitud);
          break;
        }
        case 'evento': registrarEvento(e, m.pga); break;
        case 'estado':
          e.bateria = m.bateria;
          e.wifi = m.wifi;
          portal.alDispositivo(e);
          break;
        case 'prueba_ok': portal.alPrueba(e); break;
      }
    });

    ws.on('close', () => {
      clearTimeout(limite);
      const e = id && estado.get(id);
      if (!e || e.socket !== ws) return;
      e.socket = null;
      e.enLinea = false;
      e.ultima = null;
      difundir(wssPanel, { tipo: 'dispositivo', dispositivo: resumen(e) });
      portal.alDispositivo(e);
    });
  });

  function registrarEvento(e, pga) {
    const ahora = Date.now();
    const fecha = new Date(ahora).toISOString();
    const id = db.guardarEvento({ dispositivo_id: e.d.id, fecha, pga });
    e.alertaHasta = ahora + config.DURACION_ALERTA_MS;
    log(`[EVENTO] ${e.d.nombre} (${e.d.ciudad}) superó el umbral · ${pga.toFixed(3)} g`);
    const evento = { id, dispositivo_id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, fecha, pga };
    difundir(wssPanel, { tipo: 'evento', evento, dispositivo: resumen(e) });
    portal.alEvento(e, evento);
    detector.registrarEvento({ id: e.d.id, lat: e.d.lat, lon: e.d.lon, pga, t: ahora });
  }

  // Las lecturas llegan 10 veces por segundo por dispositivo; a las pantallas se envían agrupadas.
  const temporizador = setInterval(() => {
    const datos = [];
    for (const e of estado.values()) {
      if (!e.enLinea || !e.ultima) continue;
      datos.push({ id: e.d.id, m: Math.max(e.pico, e.ultima.m), x: e.ultima.x, y: e.ultima.y, z: e.ultima.z, alerta: Date.now() < e.alertaHasta });
      e.pico = 0;
    }
    if (wssPanel.clients.size) difundir(wssPanel, { tipo: 'lecturas', t: Date.now(), datos });
    portal.alLecturas(datos);
  }, INTERVALO_LECTURAS_MS);

  const limpieza = setInterval(() => db.borrarSesionesVencidas(Date.now()), 60_000);

  function cerrar() {
    clearInterval(temporizador);
    clearInterval(limpieza);
    portal.cerrar();
    for (const ws of [...wssDispositivos.clients, ...wssPanel.clients]) ws.terminate();
    return new Promise((resolver) => server.close(resolver));
  }

  return { app, server, detector, cerrar };
}

function enviar(ws, mensaje) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensaje));
}

function difundir(wss, mensaje) {
  const texto = JSON.stringify(mensaje);
  let n = 0;
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) { ws.send(texto); n++; }
  }
  return n;
}

module.exports = { crearServidor };
