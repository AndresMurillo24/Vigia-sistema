/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/ayuda.js
 * Tipo:     JavaScript (pruebas)
 * Capa:     Pruebas
 * Qué hace: Funciones compartidas por las pruebas: levantar un servidor de prueba, iniciar sesión
 *           y conectar dispositivos.
 */
'use strict';
// Utilidades compartidas por las pruebas de integración.
const WebSocket = require('ws');
const { abrirBaseDatos } = require('../servidor/db');
const { crearServidor } = require('../servidor/app');
const { hashToken, hashClave } = require('../servidor/seguridad');
const config = require('../servidor/config');

const TOKEN_A = 'token-de-prueba-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'token-de-prueba-bbbbbbbbbbbbbbbb';
const CLAVE = 'clave-de-prueba-123';
const CODIGO_A = 'VG-AAAA-1111';
const CODIGO_B = 'VG-BBBB-2222';

async function preparar() {
  const db = abrirBaseDatos(':memory:');
  db.guardarDispositivo({ id: 'casa-a', nombre: 'Casa A', ciudad: 'Bogotá', lat: 4.65, lon: -74.06, token_hash: hashToken(TOKEN_A), codigo_hash: hashToken(CODIGO_A) });
  db.guardarDispositivo({ id: 'casa-b', nombre: 'Casa B', ciudad: 'Soacha', lat: 4.58, lon: -74.22, token_hash: hashToken(TOKEN_B), codigo_hash: hashToken(CODIGO_B) });
  db.guardarUsuario({ usuario: 'ana', nombre: 'Ana Admin', rol: 'admin', clave_hash: hashClave(CLAVE) });
  db.guardarUsuario({ usuario: 'oscar', nombre: 'Óscar Operador', rol: 'operador', clave_hash: hashClave(CLAVE) });
  const p = crearServidor({ db, config, log: () => {} });
  await new Promise((ok) => p.server.listen(0, ok));
  const puerto = p.server.address().port;
  return { ...p, db, puerto, http: `http://localhost:${puerto}`, ws: `ws://localhost:${puerto}` };
}

/** Inicia sesión y devuelve la cookie para usarla en las siguientes peticiones. */
async function iniciarSesion(p, usuario, clave = CLAVE) {
  const r = await fetch(`${p.http}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, clave }) });
  return { r, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

/** Crea una cuenta de cliente y devuelve su cookie de sesión. */
async function registrarCliente(p, correo, nombre = 'Familia de prueba') {
  const r = await fetch(`${p.http}/api/cliente/registro`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, correo, clave: CLAVE }) });
  return { r, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

/** Conecta un dispositivo simulado y espera la bienvenida. */
async function conectarDispositivo(p, id, token) {
  const ws = await abrir(`${p.ws}/ws/dispositivo`);
  const bienvenida = esperar(ws, 'bienvenida');
  ws.send(JSON.stringify({ tipo: 'hola', id, token }));
  return { ws, bienvenida: await bienvenida };
}

const pedir = (url, metodo, cuerpo, cookie = '') => fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
const postJSON = (url, cuerpo, cookie = '') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(cuerpo) });
const abrir = (url, cookie) => new Promise((ok, mal) => { const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : {}); ws.once('open', () => ok(ws)); ws.once('error', mal); });
const esperar = (ws, tipo) => new Promise((ok) => ws.on('message', function f(raw) { const m = JSON.parse(raw); if (m.tipo === tipo) { ws.off('message', f); ok(m); } }));
const cierre = (ws) => new Promise((ok) => ws.once('close', (codigo) => ok(codigo)));

module.exports = { preparar, iniciarSesion, registrarCliente, conectarDispositivo, pedir, postJSON, abrir, esperar, cierre, TOKEN_A, TOKEN_B, CLAVE, CODIGO_A, CODIGO_B };
