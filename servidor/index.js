'use strict';

const config = require('./config');
const { abrirBaseDatos } = require('./db');
const { sembrarDispositivos } = require('./semilla');
const { crearServidor } = require('./app');

function iniciarServidor() {
  const db = abrirBaseDatos(config.RUTA_DB);
  const n = sembrarDispositivos(db);
  const plataforma = crearServidor({ db, config });
  return new Promise((resolver) => {
    plataforma.server.listen(config.PUERTO, () => {
      console.log(`Plataforma Vigía lista · ${n} dispositivos registrados`);
      console.log(`Panel de monitoreo: http://localhost:${config.PUERTO}`);
      resolver(plataforma);
    });
  });
}

if (require.main === module) iniciarServidor();

module.exports = { iniciarServidor };
