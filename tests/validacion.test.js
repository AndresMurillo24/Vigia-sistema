/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/validacion.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas de la validación de mensajes y de la simulación.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarMensajeDispositivo, validarSimulacion } = require('../servidor/validacion');

test('acepta una lectura válida y descarta campos extra', () => {
  const r = validarMensajeDispositivo({ tipo: 'lectura', x: 0.01, y: -0.02, z: 0.003, hackeo: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.datos, { tipo: 'lectura', x: 0.01, y: -0.02, z: 0.003 });
});

test('rechaza lecturas con texto, NaN o valores imposibles', () => {
  assert.equal(validarMensajeDispositivo({ tipo: 'lectura', x: '1', y: 0, z: 0 }).ok, false);
  assert.equal(validarMensajeDispositivo({ tipo: 'lectura', x: NaN, y: 0, z: 0 }).ok, false);
  assert.equal(validarMensajeDispositivo({ tipo: 'lectura', x: 99, y: 0, z: 0 }).ok, false);
});

test('rechaza tipos desconocidos y mensajes que no son objetos', () => {
  assert.equal(validarMensajeDispositivo({ tipo: 'borrar_todo' }).ok, false);
  assert.equal(validarMensajeDispositivo([1, 2, 3]).ok, false);
  assert.equal(validarMensajeDispositivo(null).ok, false);
});

test('valida el saludo del dispositivo', () => {
  assert.equal(validarMensajeDispositivo({ tipo: 'hola', id: 'bog-suba', token: 'x'.repeat(32) }).ok, true);
  assert.equal(validarMensajeDispositivo({ tipo: 'hola', id: 'DROP TABLE', token: 'x'.repeat(32) }).ok, false);
  assert.equal(validarMensajeDispositivo({ tipo: 'hola', id: 'bog-suba', token: 'corto' }).ok, false);
});

test('la simulación solo acepta puntos dentro de Colombia y magnitudes razonables', () => {
  assert.equal(validarSimulacion({ lat: 4.37, lon: -73.21, magnitud: 6.3 }).ok, true);
  assert.equal(validarSimulacion({ lat: 40, lon: -3, magnitud: 6 }).ok, false);
  assert.equal(validarSimulacion({ lat: 4.37, lon: -73.21, magnitud: 12 }).ok, false);
});
