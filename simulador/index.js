/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  simulador/index.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de dispositivo
 * Qué hace: Crea los 12 dispositivos simulados y los conecta a la plataforma.
 */
'use strict';

const { DispositivoSimulado } = require('./dispositivo');
const lista = require('./dispositivos.json');

function iniciarSimulador({ url = `ws://localhost:${Number(process.env.PUERTO) || 3000}/ws/dispositivo` } = {}) {
  const dispositivos = lista.map((d) => new DispositivoSimulado(d, { url }));
  dispositivos.forEach((d) => d.conectar());
  console.log(`Simulador: ${dispositivos.length} dispositivos conectándose a ${url}`);
  return dispositivos;
}

if (require.main === module) iniciarSimulador();

module.exports = { iniciarSimulador };
