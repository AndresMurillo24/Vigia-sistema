'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { Detector } = require('./detector');
const { validarMensajeDispositivo, validarSimulacion } = require('./validacion');
const { verificarToken } = require('./seguridad');
const { crearAutenticacion } = require('./auth');

const INTERVALO_PANEL_MS = 200; // cada cuánto se envían las lecturas agrupadas al panel
const TIEMPO_AUTENTICACION_MS = 5000;

/**
 * Crea la plataforma central: API REST, panel web y los dos canales WebSocket
 * (/ws/dispositivo para los dispositivos y /ws/panel para el dashboard).
 */
function crearServidor({ db, config, log = console.log }) {
  const auth = crearAutenticacion({ db, config, log });

  /* ---------- estado en memoria de cada dispositivo ---------- */
  const estado = new Map();
  for (const d of db.listarDispositivos()) {
    estado.set(d.id, { d, socket: null, enLinea: false, alertaHasta: 0, ultima: null, pico: 0 });
  }
  const resumen = (e) => ({
    id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, lat: e.d.lat, lon: e.d.lon,
    enLinea: e.enLinea, enAlerta: Date.now() < e.alertaHasta,
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
    const alerta = { id, fecha, lat: a.lat, lon: a.lon, dispositivos: a.dispositivos.length, pga_max: a.pgaMax };
    log(`[ALERTA] Sismo confirmado por ${a.dispositivos.length} dispositivos · PGA máx ${a.pgaMax.toFixed(2)} g`);
    difundir(wssPanel, { tipo: 'alerta', alerta });
    // Aviso temprano: todos los dispositivos de la red reciben la alerta, aunque no hayan sentido nada aún.
    difundir(wssDispositivos, { tipo: 'alerta', alerta: { lat: a.lat, lon: a.lon, t: a.t } });
  });
  detector.on('actualizacion', (a) => {
    const id = idsAlerta.get(a.id);
    db.actualizarAlerta(id, a.dispositivos.length, a.pgaMax);
    difundir(wssPanel, { tipo: 'alerta_actualizada', alerta: { id, dispositivos: a.dispositivos.length, pga_max: a.pgaMax } });
  });

  /* ---------- HTTP: panel y API ---------- */
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '10kb' }));
  // Las peticiones que modifican algo deben ser JSON: un formulario de otro sitio no puede enviarlas.
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Se esperaba JSON' });
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));
  app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

  /* sesión */
  app.post('/api/login', auth.login);
  app.post('/api/logout', (req, res) => {
    const u = auth.logout(req, res);
    if (u) for (const ws of wssPanel.clients) if (ws.tokenHash === u.tokenHash) ws.close(4401, 'Sesión cerrada');
  });
  app.get('/api/sesion', auth.requerir(), (req, res) => {
    const { usuario, nombre, rol } = req.usuario;
    res.json({ usuario: { usuario, nombre, rol } });
  });

  /* datos (requieren sesión) */
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
    log(`[SIMULACIÓN] ${req.usuario.usuario} envió un sismo M${v.datos.magnitud} en (${v.datos.lat}, ${v.datos.lon}) a ${enviados} dispositivos`);
    res.status(202).json({ enviados });
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    log('[ERROR]', err);
    res.status(500).json({ error: 'Error interno' });
  });

  /* ---------- WebSocket ---------- */
  const server = http.createServer(app);
  const wssDispositivos = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const wssPanel = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const destino = pathname === '/ws/dispositivo' ? wssDispositivos : pathname === '/ws/panel' ? wssPanel : null;
    if (!destino) return socket.destroy();
    // El panel solo recibe datos en vivo si quien lo abre tiene una sesión válida.
    const usuario = destino === wssPanel ? auth.usuarioDeRequest(req) : null;
    if (destino === wssPanel && !usuario) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    destino.handleUpgrade(req, socket, head, (ws) => {
      if (usuario) ws.tokenHash = usuario.tokenHash;
      destino.emit('connection', ws, req);
    });
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
        enviar(ws, { tipo: 'bienvenida', umbral: config.UMBRAL_G });
        difundir(wssPanel, { tipo: 'dispositivo', dispositivo: resumen(e) });
        return;
      }

      const e = estado.get(id);
      if (m.tipo === 'lectura') {
        const magnitud = Math.hypot(m.x, m.y, m.z);
        e.ultima = { x: m.x, y: m.y, z: m.z, m: magnitud };
        e.pico = Math.max(e.pico, magnitud);
      } else if (m.tipo === 'evento') {
        registrarEvento(e, m.pga);
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
    });
  });

  function registrarEvento(e, pga) {
    const ahora = Date.now();
    const fecha = new Date(ahora).toISOString();
    const id = db.guardarEvento({ dispositivo_id: e.d.id, fecha, pga });
    e.alertaHasta = ahora + config.DURACION_ALERTA_MS;
    log(`[EVENTO] ${e.d.nombre} (${e.d.ciudad}) superó el umbral · ${pga.toFixed(3)} g`);
    difundir(wssPanel, {
      tipo: 'evento',
      evento: { id, dispositivo_id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, fecha, pga },
      dispositivo: resumen(e),
    });
    detector.registrarEvento({ id: e.d.id, lat: e.d.lat, lon: e.d.lon, pga, t: ahora });
  }

  // Las lecturas llegan 10 veces por segundo por dispositivo; al panel se envían agrupadas.
  const temporizador = setInterval(() => {
    if (wssPanel.clients.size === 0) return;
    const datos = [];
    for (const e of estado.values()) {
      if (!e.enLinea || !e.ultima) continue;
      datos.push({ id: e.d.id, m: Math.max(e.pico, e.ultima.m), x: e.ultima.x, y: e.ultima.y, z: e.ultima.z, alerta: Date.now() < e.alertaHasta });
      e.pico = 0;
    }
    difundir(wssPanel, { tipo: 'lecturas', t: Date.now(), datos });
  }, INTERVALO_PANEL_MS);

  const limpieza = setInterval(() => db.borrarSesionesVencidas(Date.now()), 60_000);

  function cerrar() {
    clearInterval(temporizador);
    clearInterval(limpieza);
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
