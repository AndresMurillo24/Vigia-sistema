'use strict';

// `npm start`: levanta la plataforma central y, enseguida, los dispositivos simulados.
const { iniciarServidor } = require('./servidor');
const { iniciarSimulador } = require('./simulador');

iniciarServidor().then(() => iniciarSimulador());
