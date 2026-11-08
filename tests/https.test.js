/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/https.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Prueba el RNF de seguridad: con certificado TLS la plataforma funciona por HTTPS y
 *           WSS (datos cifrados) y envía las cabeceras de seguridad.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { abrirBaseDatos } = require('../servidor/db');
const { crearServidor } = require('../servidor/app');
const { hashToken } = require('../servidor/seguridad');
const { obtenerCertificado } = require('../servidor/certificado');
const config = require('../servidor/config');

test('la plataforma funciona cifrada por HTTPS y WSS', async (t) => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-tls-'));
  const tls = obtenerCertificado(carpeta, () => {});
  const db = abrirBaseDatos(':memory:');
  db.guardarDispositivo({ id: 'casa-a', nombre: 'Casa A', ciudad: 'Bogotá', lat: 4.65, lon: -74.06, token_hash: hashToken('token-de-prueba-aaaaaaaaaaaaaaaa') });
  const p = crearServidor({ db, config, log: () => {}, tls });
  await new Promise((ok) => p.server.listen(0, ok));
  t.after(() => { p.cerrar(); fs.rmSync(carpeta, { recursive: true, force: true }); });
  const puerto = p.server.address().port;

  // HTTPS con cabeceras de seguridad (el certificado es autofirmado, por eso rejectUnauthorized: false).
  const cabeceras = await new Promise((ok, mal) => https.get({ host: 'localhost', port: puerto, path: '/login.html', rejectUnauthorized: false }, (r) => { r.resume(); ok(r.headers); }).on('error', mal));
  assert.match(cabeceras['strict-transport-security'], /max-age/);
  assert.match(cabeceras['content-security-policy'], /script-src 'self'/);

  // WSS: el dispositivo se autentica por el canal cifrado.
  const ws = new WebSocket(`wss://localhost:${puerto}/ws/dispositivo`, { rejectUnauthorized: false });
  await new Promise((ok) => ws.once('open', ok));
  const bienvenida = new Promise((ok) => ws.once('message', (m) => ok(JSON.parse(m))));
  ws.send(JSON.stringify({ tipo: 'hola', id: 'casa-a', token: 'token-de-prueba-aaaaaaaaaaaaaaaa' }));
  assert.equal((await bienvenida).tipo, 'bienvenida');
  ws.close();
});
