/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  simulador/index.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de dispositivo
 * Qué hace: Crea los 12 dispositivos simulados y los conecta a la plataforma. Ejecutado solo
 *           («npm run simulador»), acepta el comando «sismo» para probar los dispositivos sin
 *           conexión a la plataforma.
 */
'use strict';

const readline = require('node:readline');
const { DispositivoSimulado } = require('./dispositivo');
const lista = require('./dispositivos.json');

function iniciarSimulador({ url, autofirmado = false } = {}) {
  url ??= process.env.SIMULADOR_URL || `ws://localhost:${Number(process.env.PUERTO) || 3000}/ws/dispositivo`;
  // Con un certificado autofirmado (solo en pruebas) el dispositivo acepta la conexión cifrada igual.
  const wsOpciones = autofirmado || process.env.SIMULADOR_AUTOFIRMADO === 'true' ? { rejectUnauthorized: false } : {};
  const dispositivos = lista.map((d) => new DispositivoSimulado(d, { url, wsOpciones }));
  dispositivos.forEach((d) => d.conectar());
  console.log(`Simulador: ${dispositivos.length} dispositivos conectándose a ${url}`);
  return dispositivos;
}

/** Consola del simulador: permite provocar un sismo aunque la plataforma esté apagada. */
function consola(dispositivos) {
  console.log('Escribe «sismo» (o «sismo 7.0») para simular un sismo en Paratebueno sin pasar por la plataforma.');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (linea) => {
    const [cmd, mag] = linea.trim().split(/\s+/);
    if (cmd !== 'sismo') return;
    const magnitud = Math.min(9, Math.max(3, Number(mag) || 6.3));
    console.log(`Sismo local M${magnitud} en Paratebueno: cada dispositivo decide solo si suena.`);
    dispositivos.forEach((d) => d.programarSismo({ lat: 4.37, lon: -73.21, magnitud }));
  });
}

if (require.main === module) consola(iniciarSimulador());

module.exports = { iniciarSimulador };
