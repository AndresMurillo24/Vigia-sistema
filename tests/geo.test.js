'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { distanciaKm } = require('../compartido/geo');

test('la distancia entre Bogotá y Medellín es de unos 240 km', () => {
  const d = distanciaKm({ lat: 4.711, lon: -74.072 }, { lat: 6.244, lon: -75.581 });
  assert.ok(d > 230 && d < 250, `distancia obtenida: ${d}`);
});

test('la distancia de un punto a sí mismo es cero', () => {
  assert.equal(distanciaKm({ lat: 4.7, lon: -74 }, { lat: 4.7, lon: -74 }), 0);
});
