/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/detector.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas del detector de sismos: un solo dispositivo no alerta, dos cercanos sí.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Detector } = require('../servidor/detector');

const bogota = { id: 'bog', lat: 4.65, lon: -74.06 };
const soacha = { id: 'soa', lat: 4.58, lon: -74.22 };
const barranquilla = { id: 'baq', lat: 10.99, lon: -74.79 };

test('un solo dispositivo no dispara una alerta (puede ser un portazo)', () => {
  const d = new Detector();
  const r = d.registrarEvento({ ...bogota, pga: 0.3, t: 0 });
  assert.equal(r.tipo, 'pendiente');
});

test('dos dispositivos cercanos en la misma ventana confirman el sismo', () => {
  const d = new Detector();
  let alertas = 0;
  d.on('alerta', () => alertas++);
  d.registrarEvento({ ...bogota, pga: 0.3, t: 0 });
  const r = d.registrarEvento({ ...soacha, pga: 0.2, t: 2000 });
  assert.equal(r.tipo, 'alerta');
  assert.equal(alertas, 1);
  assert.deepEqual(r.alerta.dispositivos, ['bog', 'soa']);
  assert.equal(r.alerta.pgaMax, 0.3);
});

test('dispositivos muy lejanos no se confirman entre sí', () => {
  const d = new Detector({ radioKm: 300 });
  d.registrarEvento({ ...bogota, pga: 0.3, t: 0 });
  assert.equal(d.registrarEvento({ ...barranquilla, pga: 0.3, t: 1000 }).tipo, 'pendiente');
});

test('eventos separados por más que la ventana no se suman', () => {
  const d = new Detector({ ventanaMs: 10_000 });
  d.registrarEvento({ ...bogota, pga: 0.3, t: 0 });
  assert.equal(d.registrarEvento({ ...soacha, pga: 0.3, t: 15_000 }).tipo, 'pendiente');
});

test('un tercer dispositivo se suma a la alerta activa en vez de crear otra', () => {
  const d = new Detector();
  d.registrarEvento({ ...bogota, pga: 0.3, t: 0 });
  d.registrarEvento({ ...soacha, pga: 0.2, t: 1000 });
  const r = d.registrarEvento({ id: 'kennedy', lat: 4.62, lon: -74.15, pga: 0.5, t: 3000 });
  assert.equal(r.tipo, 'actualizacion');
  assert.equal(r.alerta.dispositivos.length, 3);
  assert.equal(r.alerta.pgaMax, 0.5);
});
