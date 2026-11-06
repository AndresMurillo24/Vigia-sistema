/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  inicio.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Arranque
 * Qué hace: Punto de entrada de «npm start»: levanta la plataforma central y luego los
 *           dispositivos simulados.
 */
'use strict';

// `npm start`: levanta la plataforma central y, enseguida, los dispositivos simulados.
const { iniciarServidor } = require('./servidor');
const { iniciarSimulador } = require('./simulador');

iniciarServidor().then(() => iniciarSimulador());
