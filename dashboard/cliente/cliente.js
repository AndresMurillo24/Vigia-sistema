'use strict';

/* ============================ utilidades ============================ */
const $ = (id) => document.getElementById(id);
// Todo texto que viene del servidor (nombres, direcciones, contactos) se escapa antes de
// insertarlo en la página, para evitar XSS.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');
const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function api(ruta, metodo = 'GET', cuerpo) {
  const r = await fetch(ruta, {
    method: metodo,
    headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 401 && !ruta.endsWith('/login')) mostrar('pAcceso');
  return { ok: r.ok, status: r.status, datos };
}

let ocultarToast;
function toast(texto) {
  $('toast').textContent = texto;
  $('toast').hidden = false;
  clearTimeout(ocultarToast);
  ocultarToast = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function mostrar(id) {
  for (const p of ['pAcceso', 'pVincular', 'pApp']) $(p).hidden = p !== id;
  if (id !== 'pApp') ws?.close();
}

const datosFormulario = (form) => Object.fromEntries(new FormData(form));
async function enviarFormulario(form, accion) {
  const boton = form.querySelector('button[type=submit]');
  const error = form.querySelector('.error');
  boton.disabled = true;
  error.textContent = '';
  try { await accion(datosFormulario(form), (msg) => { error.textContent = msg; }); }
  catch { error.textContent = 'No se pudo contactar al servidor.'; }
  finally { boton.disabled = false; }
}

/* ============================ estado ============================ */
const app = { cliente: null, dispositivos: new Map(), contactos: [], eventos: [], alertas: [], limites: { umbralMin: .05, umbralMax: .4 } };
const HISTORIA = 150; // 150 lecturas cada 200 ms = 30 segundos
const historia = new Map();

async function cargar() {
  const r = await api('/api/cliente/resumen');
  if (!r.ok) return;
  Object.assign(app, { cliente: r.datos.cliente, contactos: r.datos.contactos, eventos: r.datos.eventos, alertas: r.datos.alertas, limites: r.datos.limites });
  app.dispositivos = new Map(r.datos.dispositivos.map((d) => [d.id, d]));
  if (!app.dispositivos.size) {
    $('bVolver').hidden = true;
    return mostrar('pVincular');
  }
  mostrar('pApp');
  $('hola').textContent = `Hola, ${app.cliente.nombre.split(' ')[0]}`;
  renderTodo();
  conectar();
  // Si hubo una alerta en los últimos 10 minutos y no ha respondido, se le vuelve a preguntar.
  const reciente = app.alertas.find((a) => Date.now() - new Date(a.fecha) < 10 * 60_000 && !a.respuesta);
  if (reciente) abrirAlerta(reciente, false);
}

/* ============================ acceso ============================ */
function cambiarPestana(registro) {
  $('tabIngresar').setAttribute('aria-selected', !registro);
  $('tabRegistro').setAttribute('aria-selected', registro);
  $('fIngresar').hidden = registro;
  $('fRegistro').hidden = !registro;
}
$('tabIngresar').onclick = () => cambiarPestana(false);
$('tabRegistro').onclick = () => cambiarPestana(true);

$('fIngresar').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    if (!d.correo || !d.clave) return error('Escribe tu correo y tu contraseña.');
    const r = await api('/api/cliente/login', 'POST', d);
    if (!r.ok) { e.target.clave.value = ''; return error(r.datos.error || 'No se pudo ingresar.'); }
    e.target.reset();
    cargar();
  });
});

$('fRegistro').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/registro', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo crear la cuenta.');
    e.target.reset();
    cargar();
  });
});

$('fVincular').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/vincular', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo vincular.');
    e.target.reset();
    toast(`${r.datos.dispositivo.nombre} quedó vinculado a tu cuenta.`);
    cargar();
  });
});
$('bVolver').onclick = () => mostrar('pApp');
$('bOtro').onclick = () => { $('bVolver').hidden = false; mostrar('pVincular'); };

document.querySelectorAll('[data-salir]').forEach((b) => b.addEventListener('click', async () => {
  await api('/api/cliente/logout', 'POST', {});
  cambiarPestana(false);
  mostrar('pAcceso');
}));

/* ============================ pestañas ============================ */
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.toggleAttribute('aria-current', x === b));
  for (const s of ['tInicio', 'tHistorial', 'tAjustes']) $(s).hidden = s !== b.dataset.tab;
  if (b.dataset.tab === 'tInicio') dibujarGraficas();
  window.scrollTo(0, 0);
}));

/* ============================ render ============================ */
function estadoDe(d) { return !d.enLinea ? ['off', 'Desconectado'] : d.enAlerta ? ['al', 'ALERTA'] : ['', 'En línea']; }
function wifiTexto(dbm) {
  if (dbm == null) return '–';
  return dbm > -55 ? 'Excelente' : dbm > -67 ? 'Buena' : dbm > -75 ? 'Regular' : 'Débil';
}

function tarjetaDispositivo(d) {
  const [clase, texto] = estadoDe(d);
  const bajaBateria = d.bateria != null && d.bateria < 20;
  return `<article class="tarjeta disp" data-id="${esc(d.id)}">
    <header>
      <div><h3>${esc(d.nombre)}</h3><p class="lugar">${esc(d.direccion ? `${d.direccion} · ${d.ciudad}` : d.ciudad)}</p></div>
      <span class="chip ${clase}">${texto}</span>
    </header>
    <div class="medidas">
      <div class="medida${bajaBateria ? ' baja' : ''}"><span>Batería</span><strong>${d.bateria == null ? '–' : d.bateria + ' %'}</strong></div>
      <div class="medida"><span>WiFi</span><strong>${wifiTexto(d.wifi)}</strong></div>
      <div class="medida"><span>Sensibilidad</span><strong>${num(d.umbral)} g</strong></div>
    </div>
    <canvas class="grafica" width="600" height="140" aria-label="Vibración de los últimos 30 segundos"></canvas>
    <p class="leyenda">Vibración de los últimos 30 segundos. La línea punteada es tu umbral de alerta.</p>
    <button type="button" class="boton secundario" data-prueba="${esc(d.id)}"${d.enLinea ? '' : ' disabled'}>Probar la alarma</button>
  </article>`;
}

function formularioAjustes(d) {
  const { umbralMin: mn, umbralMax: mx } = app.limites;
  return `<form class="tarjeta" data-ajustes="${esc(d.id)}" novalidate>
    <h3>${esc(d.nombre)}</h3>
    <label>Nombre del dispositivo <input name="nombre" value="${esc(d.nombre)}" maxlength="40" required></label>
    <label>Dirección <input name="direccion" value="${esc(d.direccion)}" maxlength="120" placeholder="Ej.: Calle 60 # 9-23, apto 402"></label>
    <div class="rango">
      <label for="u-${esc(d.id)}">Sensibilidad · alerta desde <output>${num(d.umbral)} g</output></label>
      <input id="u-${esc(d.id)}" name="umbral" type="range" min="${mn}" max="${mx}" step="0.01" value="${d.umbral}">
      <div class="extremos"><span>Más sensible</span><span>Menos sensible</span></div>
    </div>
    <p class="nota">Más sensible avisa con sismos leves, pero puede activarse con vibraciones fuertes de la calle. El valor recomendado es 0,15 g.</p>
    <p class="error" role="alert"></p>
    <button type="submit" class="boton">Guardar cambios</button>
  </form>`;
}

function renderInicio() {
  $('listaDispositivos').innerHTML = [...app.dispositivos.values()].map(tarjetaDispositivo).join('');
  const n = app.contactos.length;
  $('avisoContactos').innerHTML = n
    ? `<h3>Contactos de emergencia</h3><p>Tienes ${n} ${n === 1 ? 'contacto' : 'contactos'}: ${app.contactos.map((c) => esc(c.nombre)).join(', ')}.</p>`
    : `<h3>Agrega un contacto de emergencia</h3><p class="nota">Si después de un sismo marcas «Necesito ayuda», avisaremos a estas personas.</p><button type="button" class="boton secundario" data-ir="tAjustes">Agregar contacto</button>`;
  dibujarGraficas();
}

function renderHistorial() {
  $('listaAlertas').innerHTML = app.alertas.length ? app.alertas.map((a) => `<li>
      <strong>Sismo${a.distanciaKm != null ? ` a ${a.distanciaKm} km de ${esc(a.dispositivo)}` : ''}</strong>
      <span class="fecha">${fecha(a.fecha)}</span>
      ${a.respuesta ? `<span>Respondiste: <b>${a.respuesta === 'bien' ? 'Estoy bien' : 'Necesito ayuda'}</b></span>`
        : `<div class="resp"><button type="button" class="boton secundario" data-resp-alerta="${a.id}" data-estado="bien">Estoy bien</button><button type="button" class="boton peligro" data-resp-alerta="${a.id}" data-estado="ayuda">Necesito ayuda</button></div>`}
    </li>`).join('') : '<li class="vacio">No ha habido alertas de sismo.</li>';
  $('listaEventos').innerHTML = app.eventos.length ? app.eventos.map((e) => `<li>
      <strong>${esc(e.nombre)} detectó ${num(e.pga)} g</strong><span class="fecha">${fecha(e.fecha)}</span>
    </li>`).join('') : '<li class="vacio">Tus dispositivos no han detectado vibraciones fuertes.</li>';
}

function renderAjustes() {
  $('ajustesDispositivos').innerHTML = [...app.dispositivos.values()].map(formularioAjustes).join('');
  $('listaContactos').innerHTML = app.contactos.length ? app.contactos.map((c) => `<li>
      <span><strong>${esc(c.nombre)}</strong><span class="fecha">${esc(c.telefono)}${c.relacion ? ' · ' + esc(c.relacion) : ''}</span></span>
      <button type="button" class="quitar" data-quitar="${c.id}" aria-label="Quitar a ${esc(c.nombre)}">Quitar</button>
    </li>`).join('') : '<li class="vacio">Todavía no tienes contactos.</li>';
  $('fContacto').hidden = app.contactos.length >= 5;
}

function renderTodo() { renderInicio(); renderHistorial(); renderAjustes(); }

/* ============================ gráficas ============================ */
function dibujarGraficas() {
  if ($('tInicio').hidden) return;
  const oscuro = matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelectorAll('#listaDispositivos .disp').forEach((art) => {
    const d = app.dispositivos.get(art.dataset.id);
    const c = art.querySelector('canvas'), x = c.getContext('2d'), w = c.width, h = c.height;
    const tope = Math.max(.3, d.umbral * 1.6), y = (v) => h - 8 - Math.min(v, tope) / tope * (h - 16);
    x.clearRect(0, 0, w, h);
    x.setLineDash([10, 8]); x.lineWidth = 2; x.strokeStyle = oscuro ? '#f2b134' : '#a86a00';
    x.beginPath(); x.moveTo(0, y(d.umbral)); x.lineTo(w, y(d.umbral)); x.stroke(); x.setLineDash([]);
    const hs = historia.get(d.id) || [];
    x.lineWidth = 4; x.strokeStyle = d.enAlerta ? '#d9381a' : (oscuro ? '#5fd0b6' : '#17705f');
    x.beginPath();
    hs.forEach((v, i) => { const px = (HISTORIA - hs.length + i) * (w / (HISTORIA - 1)); i ? x.lineTo(px, y(v)) : x.moveTo(px, y(v)); });
    x.stroke();
  });
}

/* ============================ acciones ============================ */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ir) document.querySelector(`.tabs [data-tab="${b.dataset.ir}"]`).click();
  if (b.dataset.prueba) {
    b.disabled = true;
    // El aviso se muestra antes: la confirmación del dispositivo puede llegar antes que la respuesta HTTP.
    toast('Enviando la prueba… la alarma de tu dispositivo debe sonar.');
    const r = await api(`/api/cliente/dispositivos/${encodeURIComponent(b.dataset.prueba)}/prueba`, 'POST', {});
    if (!r.ok) toast(r.datos.error || 'No se pudo probar.');
    setTimeout(() => { b.disabled = false; }, 4000);
  }
  if (b.dataset.quitar) {
    const r = await api(`/api/cliente/contactos/${encodeURIComponent(b.dataset.quitar)}`, 'DELETE');
    if (r.ok) { app.contactos = app.contactos.filter((c) => String(c.id) !== b.dataset.quitar); renderAjustes(); renderInicio(); }
  }
  if (b.dataset.respAlerta) responder(Number(b.dataset.respAlerta), b.dataset.estado);
});

document.addEventListener('input', (e) => {
  if (e.target.name === 'umbral') e.target.closest('.rango').querySelector('output').textContent = `${num(e.target.value)} g`;
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-ajustes]');
  if (!form) return;
  e.preventDefault();
  enviarFormulario(form, async (d, error) => {
    const id = form.dataset.ajustes;
    const r = await api(`/api/cliente/dispositivos/${encodeURIComponent(id)}`, 'PATCH', { nombre: d.nombre, direccion: d.direccion, umbral: Number(d.umbral) });
    if (!r.ok) return error(r.datos.error || 'No se pudo guardar.');
    app.dispositivos.set(id, r.datos.dispositivo);
    renderTodo();
    toast('Cambios guardados. Tu dispositivo ya usa la nueva sensibilidad.');
  });
});

$('fContacto').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/contactos', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo agregar.');
    app.contactos.push(r.datos.contacto);
    e.target.reset();
    renderAjustes(); renderInicio();
  });
});

/* ============================ alerta de sismo ============================ */
let alertaAbierta = null;
function abrirAlerta(a, sonar = true) {
  alertaAbierta = a;
  $('alD').textContent = a.distanciaKm != null
    ? `Se detectó un sismo a ${a.distanciaKm} km de ${a.dispositivo}. Protégete ahora y aléjate de las ventanas.`
    : 'Se detectó un sismo en la red Vigía. Protégete ahora y aléjate de las ventanas.';
  $('alBotones').hidden = !!a.respuesta;
  $('alGracias').hidden = true;
  $('alerta').hidden = false;
  $('alerta').querySelector('.bien').focus();
  if (sonar) sirena();
  navigator.vibrate?.([600, 300, 600, 300, 600]);
}
$('alCerrar').onclick = () => { $('alerta').hidden = true; };
$('alBotones').addEventListener('click', (e) => {
  const b = e.target.closest('[data-resp]');
  if (b && alertaAbierta) responder(alertaAbierta.id, b.dataset.resp);
});

async function responder(alertaId, estado) {
  const r = await api('/api/cliente/respuestas', 'POST', { alertaId, estado });
  if (!r.ok) return toast(r.datos.error || 'No se pudo enviar tu respuesta.');
  const a = app.alertas.find((x) => x.id === alertaId);
  if (a) a.respuesta = estado;
  renderHistorial();
  if (!$('alerta').hidden) {
    $('alBotones').hidden = true;
    $('alGracias').hidden = false;
    $('alGracias').textContent = estado === 'bien'
      ? 'Gracias. Registramos que estás bien.'
      : app.contactos.length
        ? `Registramos que necesitas ayuda. En la versión final se avisaría por mensaje a: ${app.contactos.map((c) => c.nombre).join(', ')}.`
        : 'Registramos que necesitas ayuda. Agrega contactos de emergencia en Ajustes para que podamos avisarles.';
  } else {
    toast('Respuesta enviada.');
  }
}

function sirena() {
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)(), o = A.createOscillator(), g = A.createGain(), n = A.currentTime;
    o.type = 'square'; o.connect(g); g.connect(A.destination);
    for (let i = 0; i < 6; i++) { o.frequency.setValueAtTime(i % 2 ? 660 : 990, n + i * .45); }
    g.gain.setValueAtTime(.05, n); g.gain.setValueAtTime(0, n + 2.7);
    o.start(n); o.stop(n + 2.8); o.onended = () => A.close();
  } catch { /* el navegador puede bloquear el sonido si no hubo interacción */ }
}

/* ============================ tiempo real ============================ */
let ws = null;
function conectar() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/cliente`);
  ws.onopen = () => { $('conexion').textContent = 'En vivo'; $('conexion').className = 'chip'; };
  ws.onclose = async (e) => {
    $('conexion').textContent = 'Sin conexión';
    $('conexion').className = 'chip off';
    if ($('pApp').hidden || e.code === 4401) return;
    const sigue = await fetch('/api/cliente/resumen').then((r) => r.ok).catch(() => true);
    if (sigue) setTimeout(conectar, 2500); else mostrar('pAcceso');
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    switch (m.tipo) {
      case 'lecturas':
        for (const l of m.datos) {
          const h = historia.get(l.id) || [];
          h.push(l.m); if (h.length > HISTORIA) h.shift();
          historia.set(l.id, h);
          const d = app.dispositivos.get(l.id);
          if (d && d.enAlerta !== l.alerta) { d.enAlerta = l.alerta; renderInicio(); }
        }
        dibujarGraficas();
        break;
      case 'dispositivo':
        if (app.dispositivos.has(m.dispositivo.id)) { app.dispositivos.set(m.dispositivo.id, m.dispositivo); renderInicio(); }
        break;
      case 'evento':
        app.eventos.unshift(m.evento);
        if (app.dispositivos.has(m.dispositivo.id)) app.dispositivos.set(m.dispositivo.id, m.dispositivo);
        renderInicio(); renderHistorial();
        toast(`${m.evento.nombre} detectó una vibración de ${num(m.evento.pga)} g.`);
        break;
      case 'alerta':
        app.alertas.unshift(m.alerta);
        renderHistorial();
        abrirAlerta(m.alerta);
        break;
      case 'prueba_ok': {
        const d = app.dispositivos.get(m.id);
        toast(`La alarma de ${d ? d.nombre : 'tu dispositivo'} sonó correctamente.`);
        break;
      }
    }
  };
}

cargar().then(() => { if ($('pApp').hidden && $('pVincular').hidden) mostrar('pAcceso'); });
