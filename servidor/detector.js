'use strict';

const { EventEmitter } = require('node:events');
const { distanciaKm } = require('../compartido/geo');

/**
 * Decide cuándo un conjunto de eventos individuales es un sismo real.
 *
 * Un solo dispositivo puede vibrar por un portazo o un camión; por eso la plataforma
 * declara una alerta solo cuando al menos `minDispositivos` cercanos (dentro de `radioKm`)
 * reportan un evento dentro de la misma ventana de tiempo.
 *
 * Emite:
 *  - 'alerta'        cuando se confirma un sismo nuevo
 *  - 'actualizacion' cuando otro dispositivo se suma a la alerta activa
 */
class Detector extends EventEmitter {
  constructor({ ventanaMs = 10_000, minDispositivos = 2, radioKm = 300 } = {}) {
    super();
    this.ventanaMs = ventanaMs;
    this.minDispositivos = minDispositivos;
    this.radioKm = radioKm;
    this.eventos = [];
    this.alerta = null;
    this.siguienteId = 1;
  }

  /** @param {{id:string, lat:number, lon:number, pga:number, t:number}} ev */
  registrarEvento(ev) {
    // Solo se conservan los eventos dentro de la ventana y el más reciente de cada dispositivo.
    this.eventos = this.eventos.filter((e) => ev.t - e.t <= this.ventanaMs && e.id !== ev.id);
    this.eventos.push(ev);

    const a = this.alerta;
    if (a && ev.t - a.ultimo <= this.ventanaMs && distanciaKm(a, ev) <= this.radioKm) {
      if (!a.dispositivos.includes(ev.id)) a.dispositivos.push(ev.id);
      a.pgaMax = Math.max(a.pgaMax, ev.pga);
      a.ultimo = ev.t;
      const copia = this.#copia();
      this.emit('actualizacion', copia);
      return { tipo: 'actualizacion', alerta: copia };
    }

    const cercanos = this.eventos.filter((e) => distanciaKm(e, ev) <= this.radioKm);
    if (cercanos.length < this.minDispositivos) {
      return { tipo: 'pendiente', faltan: this.minDispositivos - cercanos.length };
    }

    // Epicentro estimado: promedio de las posiciones ponderado por la aceleración medida.
    const peso = cercanos.reduce((s, e) => s + e.pga, 0);
    this.alerta = {
      id: this.siguienteId++,
      t: ev.t,
      ultimo: ev.t,
      lat: cercanos.reduce((s, e) => s + e.lat * e.pga, 0) / peso,
      lon: cercanos.reduce((s, e) => s + e.lon * e.pga, 0) / peso,
      dispositivos: cercanos.map((e) => e.id),
      pgaMax: Math.max(...cercanos.map((e) => e.pga)),
    };
    const copia = this.#copia();
    this.emit('alerta', copia);
    return { tipo: 'alerta', alerta: copia };
  }

  #copia() {
    return { ...this.alerta, dispositivos: [...this.alerta.dispositivos] };
  }
}

module.exports = { Detector };
