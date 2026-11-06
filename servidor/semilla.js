'use strict';

const { hashToken } = require('./seguridad');
const dispositivos = require('../simulador/dispositivos.json');

/**
 * Registra en la base de datos los dispositivos del simulador.
 * En un despliegue real cada dispositivo se registraría al instalarse, con un token único
 * entregado de forma segura; nunca guardado en el repositorio.
 */
function sembrarDispositivos(db) {
  for (const d of dispositivos) {
    // El código de vinculación (impreso en la caja) también se guarda solo como hash.
    db.guardarDispositivo({ id: d.id, nombre: d.nombre, ciudad: d.ciudad, lat: d.lat, lon: d.lon, token_hash: hashToken(d.token), codigo_hash: hashToken(d.codigo) });
  }
  return dispositivos.length;
}

module.exports = { sembrarDispositivos };
