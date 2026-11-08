/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/index.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de backend
 * Qué hace: Arranca la plataforma central: abre la base de datos, registra los dispositivos y crea
 *           el administrador.
 */
'use strict';

const config = require('./config');
const { abrirBaseDatos } = require('./db');
const { sembrarDispositivos } = require('./semilla');
const { crearServidor } = require('./app');
const { asegurarAdministrador } = require('./auth');
const { obtenerCertificado } = require('./certificado');
const path = require('node:path');

function iniciarServidor() {
  const db = abrirBaseDatos(config.RUTA_DB);
  const n = sembrarDispositivos(db);
  asegurarAdministrador(db);
  const tls = config.HTTPS ? obtenerCertificado(path.dirname(config.RUTA_DB)) : null;
  const plataforma = crearServidor({ db, config, tls });
  const protocolo = tls ? 'https' : 'http';
  return new Promise((resolver) => {
    plataforma.server.listen(config.PUERTO, () => {
      console.log(`Plataforma Vigía lista · ${n} dispositivos registrados${tls ? ' · conexión cifrada (HTTPS/WSS)' : ''}`);
      console.log(`Panel de la empresa: ${protocolo}://localhost:${config.PUERTO}`);
      console.log(`App del cliente:     ${protocolo}://localhost:${config.PUERTO}/cliente`);
      resolver({ ...plataforma, tls, url: `${tls ? 'wss' : 'ws'}://localhost:${config.PUERTO}/ws/dispositivo` });
    });
  });
}

if (require.main === module) iniciarServidor();

module.exports = { iniciarServidor };
