'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { abrirBaseDatos } = require('../servidor/db');
const { crearServidor } = require('../servidor/app');
const { hashToken } = require('../servidor/seguridad');
const config = require('../servidor/config');

const TOKEN_A = 'token-de-prueba-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'token-de-prueba-bbbbbbbbbbbbbbbb';

function preparar() {
  const db = abrirBaseDatos(':memory:');
  db.guardarDispositivo({ id: 'casa-a', nombre: 'Casa A', ciudad: 'Bogotá', lat: 4.65, lon: -74.06, token_hash: hashToken(TOKEN_A) });
  db.guardarDispositivo({ id: 'casa-b', nombre: 'Casa B', ciudad: 'Soacha', lat: 4.58, lon: -74.22, token_hash: hashToken(TOKEN_B) });
  const p = crearServidor({ db, config, log: () => {} });
  return new Promise((ok) => p.server.listen(0, () => ok({ ...p, db, puerto: p.server.address().port })));
}

const abrir = (url) => new Promise((ok, mal) => { const ws = new WebSocket(url); ws.once('open', () => ok(ws)); ws.once('error', mal); });
const esperar = (ws, tipo) => new Promise((ok) => ws.on('message', function f(raw) { const m = JSON.parse(raw); if (m.tipo === tipo) { ws.off('message', f); ok(m); } }));
const cierre = (ws) => new Promise((ok) => ws.once('close', (codigo) => ok(codigo)));

test('rechaza un dispositivo con token incorrecto', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const ws = await abrir(`ws://localhost:${p.puerto}/ws/dispositivo`);
  ws.send(JSON.stringify({ tipo: 'hola', id: 'casa-a', token: 'token-falso-xxxxxxxxxxxxxxxxx' }));
  assert.equal(await cierre(ws), 4003);
});

test('dos dispositivos que detectan vibración generan una alerta en el panel y en la red', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const base = `ws://localhost:${p.puerto}`;
  const panel = await abrir(`${base}/ws/panel`);
  const a = await abrir(`${base}/ws/dispositivo`);
  const b = await abrir(`${base}/ws/dispositivo`);
  a.send(JSON.stringify({ tipo: 'hola', id: 'casa-a', token: TOKEN_A }));
  b.send(JSON.stringify({ tipo: 'hola', id: 'casa-b', token: TOKEN_B }));
  await Promise.all([esperar(a, 'bienvenida'), esperar(b, 'bienvenida')]);

  const alertaPanel = esperar(panel, 'alerta');
  const alertaRed = esperar(a, 'alerta');
  a.send(JSON.stringify({ tipo: 'evento', pga: 0.32 }));
  b.send(JSON.stringify({ tipo: 'evento', pga: 0.21 }));

  const { alerta } = await alertaPanel;
  assert.equal(alerta.dispositivos, 2);
  assert.equal(alerta.pga_max, 0.32);
  await alertaRed;
  assert.equal(p.db.ultimasAlertas().length, 1);
  assert.equal(p.db.ultimosEventos().length, 2);
  for (const ws of [panel, a, b]) ws.close();
});

test('la API rechaza una simulación fuera de Colombia', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const r = await fetch(`http://localhost:${p.puerto}/api/simulacion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 40, lon: -3, magnitud: 6 }) });
  assert.equal(r.status, 400);
});
