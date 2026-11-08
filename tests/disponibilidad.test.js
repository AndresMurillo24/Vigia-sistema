/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/disponibilidad.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Prueba el RNF de disponibilidad: el dispositivo detecta y hace sonar su alarma sin
 *           conexión a la plataforma, y envía los eventos guardados al reconectarse.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayuda');
const { DispositivoSimulado } = require('../simulador/dispositivo');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('sin conexión, el dispositivo detecta el sismo, suena y guarda el evento; al reconectarse lo envía', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const datos = { id: 'casa-a', nombre: 'Casa A', ciudad: 'Bogotá', lat: 4.65, lon: -74.06, token: h.TOKEN_A };
  const d = new DispositivoSimulado(datos, { url: `${p.ws}/ws/dispositivo`, log: () => {} });
  t.after(() => d.detener());

  // 1. Sin plataforma: solo el sensor está encendido.
  d.iniciarSensor();
  d.programarSismo({ lat: 4.65, lon: -74.06, magnitud: 6.5 });
  await espera(1500);
  assert.ok(d.alarmaHasta > Date.now(), 'la alarma local sonó sin conexión (RF02)');
  assert.ok(d.pendientes.length >= 1, 'el evento quedó guardado');
  assert.equal(p.db.ultimosEventos().length, 0, 'la plataforma todavía no sabe nada');

  // 2. Vuelve la conexión: envía lo pendiente.
  d.conectar();
  for (let i = 0; i < 30 && p.db.ultimosEventos().length === 0; i++) await espera(100);
  assert.equal(d.pendientes.length, 0);
  assert.equal(p.db.ultimosEventos()[0].dispositivo_id, 'casa-a');
});
