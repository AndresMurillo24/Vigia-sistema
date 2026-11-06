/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/seguridad.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas del hash y la verificación de tokens.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashToken, verificarToken } = require('../servidor/seguridad');

test('el token correcto se verifica y uno incorrecto no', () => {
  const hash = hashToken('token-secreto-de-prueba-123');
  assert.equal(verificarToken('token-secreto-de-prueba-123', hash), true);
  assert.equal(verificarToken('otro-token-cualquiera-0000', hash), false);
});

test('el hash no contiene el token en texto plano', () => {
  assert.ok(!hashToken('mi-token-1234567890').includes('mi-token'));
});
