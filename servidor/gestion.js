/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/gestion.js
 * Tipo:     JavaScript (Node.js · Express)
 * Capa:     Capa de backend
 * Qué hace: Rutas de gestión del panel de la empresa: historial consultable con filtros y
 *           exportación CSV (RF04), dispositivos y clientes de la red, y solicitudes de ayuda.
 */
'use strict';

const { validarFiltros } = require('./validacion');

const POR_PAGINA = 25;
const MAX_CSV = 5000;

/**
 * Evita la «inyección de fórmulas» en CSV: si una celda empieza por =, +, - o @, Excel podría
 * ejecutarla como fórmula. Se antepone un apóstrofo y se escapan las comillas.
 */
function celdaCSV(valor) {
  let s = String(valor ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function montarGestion({ app, db, auth, estado, avisarPanel, portal, log }) {
  /* ---------- historial consultable (RF04) ---------- */
  app.get('/api/historial', auth.requerir(), (req, res) => {
    const v = validarFiltros(req.query);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { tipo, filtros, pagina } = v.datos;
    const { total, items } = db.historial(tipo, filtros, POR_PAGINA, (pagina - 1) * POR_PAGINA);
    res.json({ tipo, pagina, porPagina: POR_PAGINA, total, items });
  });

  app.get('/api/historial.csv', auth.requerir(), (req, res) => {
    const v = validarFiltros(req.query);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { tipo, filtros } = v.datos;
    const { items } = db.historial(tipo, filtros, MAX_CSV, 0);
    const columnas = tipo === 'alertas'
      ? [['id', 'Alerta'], ['fecha', 'Fecha (UTC)'], ['lat', 'Latitud'], ['lon', 'Longitud'], ['dispositivos', 'Dispositivos'], ['pga_max', 'PGA máx (g)'], ['bien', 'Hogares bien'], ['ayuda', 'Piden ayuda']]
      : [['id', 'Evento'], ['fecha', 'Fecha (UTC)'], ['dispositivo_id', 'Dispositivo'], ['nombre', 'Nombre'], ['ciudad', 'Ciudad'], ['pga', 'PGA (g)']];
    const filas = [columnas.map(([, t]) => t), ...items.map((it) => columnas.map(([k]) => it[k]))];
    const csv = '﻿' + filas.map((f) => f.map(celdaCSV).join(';')).join('\r\n'); // BOM y ; para que Excel lo abra bien
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vigia-${tipo}.csv"` });
    res.send(csv);
  });

  app.get('/api/ciudades', auth.requerir(), (req, res) => res.json({ ciudades: db.ciudades() }));

  /* ---------- dispositivos y clientes ---------- */
  app.get('/api/red', auth.requerir(), (req, res) => {
    const clientes = db.clientesResumen();
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const dispositivos = [...estado.values()].map((e) => {
      const c = e.d.cliente_id ? porId.get(e.d.cliente_id) : null;
      return {
        id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, direccion: e.d.direccion, umbral: e.d.umbral,
        enLinea: e.enLinea, ultimaConexion: e.d.ultima_conexion, bateria: e.bateria, wifi: e.wifi,
        dueno: c ? { nombre: c.nombre, correo: c.correo } : null,
      };
    });
    res.json({ dispositivos, clientes });
  });

  // Solo un administrador puede desvincular (por ejemplo, cuando una casa se vende).
  app.post('/api/dispositivos/:id/desvincular', auth.requerir('admin'), (req, res) => {
    const e = estado.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    const anterior = e.d.cliente_id;
    if (!anterior || !db.desvincularDispositivo(e.d.id)) return res.status(409).json({ error: 'El dispositivo no está vinculado' });
    e.d = db.obtenerDispositivo(e.d.id);
    portal.alDesvincular(anterior, e.d.id);
    // El dispositivo vuelve al umbral recomendado.
    if (e.socket) e.socket.send(JSON.stringify({ tipo: 'config', umbral: e.d.umbral }));
    log(`[GESTIÓN] ${req.cuenta.usuario} desvinculó ${e.d.nombre}`);
    res.json({ ok: true });
  });

  /* ---------- solicitudes de ayuda después de un sismo ---------- */
  function solicitudes() {
    return db.solicitudesAyuda(50).map((s) => ({
      ...s,
      atendida: !!s.atendida,
      dispositivos: db.dispositivosDeCliente(s.cliente_id).map((d) => ({ nombre: d.nombre, ciudad: d.ciudad, direccion: d.direccion })),
      contactos: db.listarContactos(s.cliente_id),
    }));
  }

  app.get('/api/ayuda', auth.requerir(), (req, res) => res.json({ solicitudes: solicitudes(), pendientes: db.pendientesAyuda() }));

  app.post('/api/ayuda/:id/atender', auth.requerir(), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !db.atenderSolicitud(id, req.cuenta.usuario)) {
      return res.status(404).json({ error: 'Solicitud no encontrada o ya atendida' });
    }
    log(`[AYUDA] ${req.cuenta.usuario} atendió la solicitud ${id}`);
    avisarPanel({ tipo: 'solicitudes', pendientes: db.pendientesAyuda() });
    res.json({ ok: true });
  });

  return { avisarSolicitudes: () => avisarPanel({ tipo: 'solicitudes', pendientes: db.pendientesAyuda() }) };
}

module.exports = { montarGestion, celdaCSV };
