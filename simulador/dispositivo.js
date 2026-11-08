/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  simulador/dispositivo.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de dispositivo
 * Qué hace: Firmware simulado del ESP32: lee el acelerómetro 10 veces por segundo, detecta
 *           vibraciones, hace sonar la alarma, reporta batería y WiFi y guarda los eventos si
 *           no hay conexión.
 */
'use strict';

const WebSocket = require('ws');
const { distanciaKm } = require('../compartido/geo');
const { pgaEstimada, tiemposDeLlegada, amplitud } = require('./modelo');

const RUIDO_G = 0.004; // vibración de fondo normal de una casa
const DURACION_ALARMA_MS = 15_000;
const REINTENTO_MS = 3000;
const INTERVALO_ESTADO_MS = 15_000; // cada cuánto se reporta batería y WiFi
const MAX_PENDIENTES = 50; // eventos que el dispositivo guarda mientras no tiene conexión

/**
 * Simula el firmware del ESP32: lee el acelerómetro 10 veces por segundo, envía las lecturas
 * a la plataforma, detecta localmente cuando se supera el umbral y activa su alarma.
 *
 * Disponibilidad (RNF): el sensor y la alarma funcionan aunque no haya conexión. Los eventos
 * detectados sin conexión se guardan y se envían, con su hora real, al reconectarse.
 */
class DispositivoSimulado {
  constructor(datos, { url, hz = 10, log = console.log, wsOpciones = {} } = {}) {
    this.datos = datos;
    this.url = url;
    this.periodo = 1000 / hz;
    this.log = log;
    this.wsOpciones = wsOpciones;
    this.umbral = 0.15; // se conserva el último umbral recibido aunque se pierda la conexión
    this.sismos = [];
    this.pendientes = [];
    this.alarmaHasta = 0;
    this.reporteHasta = 0;
    this.autenticado = false;
    this.detenido = false;
    // Batería y señal de cada casa (fijas por dispositivo, con pequeñas variaciones).
    const semilla = [...datos.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    this.bateria = 62 + (semilla * 7) % 38;
    this.wifi = -42 - (semilla * 13) % 40;
  }

  /** El sensor empieza a leer de inmediato, con o sin conexión a la plataforma. */
  iniciarSensor() {
    if (!this.bucle) this.bucle = setInterval(() => this.#leerSensor(), this.periodo);
  }

  conectar() {
    this.iniciarSensor();
    this.ws = new WebSocket(this.url, this.wsOpciones);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ tipo: 'hola', id: this.datos.id, token: this.datos.token })));
    this.ws.on('message', (raw) => this.#recibir(JSON.parse(raw)));
    this.ws.on('close', () => {
      this.autenticado = false;
      clearInterval(this.reporte);
      if (!this.detenido) setTimeout(() => this.conectar(), REINTENTO_MS);
    });
    this.ws.on('error', () => {}); // el evento 'close' se encarga de reintentar
  }

  detener() {
    this.detenido = true;
    clearInterval(this.bucle);
    clearInterval(this.reporte);
    this.bucle = null;
    this.ws?.close();
  }

  /** Programa la llegada de un sismo simulado (orden de la plataforma o del simulador sin conexión). */
  programarSismo({ lat, lon, magnitud, inicio = Date.now() }) {
    const d = distanciaKm(this.datos, { lat, lon });
    this.sismos.push({ pga: pgaEstimada(magnitud, d), ...tiemposDeLlegada(inicio, d), fase: Math.random() * 6 });
  }

  #recibir(msg) {
    switch (msg.tipo) {
      case 'bienvenida':
        this.umbral = msg.umbral;
        this.autenticado = true;
        clearInterval(this.reporte);
        this.#reportarEstado();
        this.reporte = setInterval(() => this.#reportarEstado(), INTERVALO_ESTADO_MS);
        if (this.pendientes.length) {
          this.log(`  [RECONEXIÓN] ${this.datos.nombre}: envía ${this.pendientes.length} evento(s) guardado(s) sin conexión`);
          for (const ev of this.pendientes.splice(0)) this.#enviar(ev);
        }
        break;
      case 'config': // el dueño cambió la sensibilidad desde la app
        this.umbral = msg.umbral;
        this.log(`  [CONFIG] ${this.datos.nombre}: nuevo umbral ${msg.umbral} g`);
        break;
      case 'prueba': // el dueño pidió probar la alarma desde la app
        this.alarmaHasta = Date.now() + 4000;
        this.log(`  [PRUEBA] ${this.datos.nombre} (${this.datos.ciudad}): LED rojo y sirena por 4 s`);
        this.#enviar({ tipo: 'prueba_ok' });
        break;
      case 'simular_sismo':
        this.programarSismo(msg);
        break;
      case 'alerta':
        if (Date.now() > this.alarmaHasta) {
          const d = distanciaKm(this.datos, msg.alerta);
          this.#activarAlarma(`aviso de la red, sismo a ${Math.round(d)} km`);
        }
        break;
    }
  }

  #leerSensor() {
    const t = Date.now();
    let x = this.#ruido(), y = this.#ruido(), z = this.#ruido();
    for (const s of this.sismos) {
      const a = amplitud(s, t);
      const w = (t / 1000) * 2 * Math.PI * 1.8 + s.fase;
      x += a * Math.sin(w);
      y += a * 0.7 * Math.sin(w * 1.3 + 1);
      z += a * 0.4 * Math.sin(w * 0.8 + 2);
    }
    this.sismos = this.sismos.filter((s) => t - s.tS < 25_000);

    const r = (v) => Math.round(v * 10000) / 10000;
    this.#enviar({ tipo: 'lectura', x: r(x), y: r(y), z: r(z) });

    // Detección local, igual que haría el firmware: no espera a la plataforma para sonar.
    const magnitud = Math.hypot(x, y, z);
    if (magnitud >= this.umbral && t > this.reporteHasta) {
      this.reporteHasta = t + DURACION_ALARMA_MS;
      const evento = { tipo: 'evento', pga: r(magnitud), t };
      if (this.autenticado) this.#enviar(evento);
      else {
        this.pendientes.push(evento);
        if (this.pendientes.length > MAX_PENDIENTES) this.pendientes.shift();
        this.log(`  [SIN CONEXIÓN] ${this.datos.nombre}: evento guardado para enviarlo al reconectar`);
      }
      if (t > this.alarmaHasta) this.#activarAlarma(`detección propia, ${magnitud.toFixed(2)} g`);
      else this.log(`  [SENSOR] ${this.datos.nombre} (${this.datos.ciudad}): llegó la sacudida (${magnitud.toFixed(2)} g); la alarma ya sonaba gracias al aviso de la red`);
    }
  }

  #activarAlarma(motivo) {
    this.alarmaHasta = Date.now() + DURACION_ALARMA_MS;
    this.log(`  [ALARMA] ${this.datos.nombre} (${this.datos.ciudad}): LED rojo y sirena · ${motivo}`);
  }

  #reportarEstado() {
    this.bateria = Math.max(5, Math.min(100, this.bateria + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.3 ? 1 : 0)));
    const wifi = Math.round(this.wifi + (Math.random() - 0.5) * 4);
    this.#enviar({ tipo: 'estado', bateria: this.bateria, wifi });
  }

  #ruido() {
    return (Math.random() - 0.5) * 2 * RUIDO_G;
  }

  #enviar(mensaje) {
    if (this.autenticado && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(mensaje));
  }
}

module.exports = { DispositivoSimulado };
