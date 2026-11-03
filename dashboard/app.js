'use strict';

/* Estado del panel */
const estado = {
  dispositivos: new Map(), // id -> { datos, m, x, y, z }
  seleccionado: null,
  umbral: 0.15,
  eventos: [],
  alertas: [],
};
const HISTORIA = 150; // 150 lecturas × 200 ms = 30 s en la gráfica
const historia = new Map(); // id -> números
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (v == null ? '–' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ','));
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ---------- mapa ---------- */
const NS = 'http://www.w3.org/2000/svg';
const svg = $('mapa');
function el(nombre, attrs, padre = svg) {
  const n = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  padre.appendChild(n);
  return n;
}
el('polygon', { class: 'pais', points: MAPA.contorno.map(([lo, la]) => `${MAPA.x(lo)},${MAPA.y(la)}`).join(' ') });
const capaOndas = el('g', {});
const capaEtiquetas = el('g', {});
const capaPuntos = el('g', {});
const ciudadesDibujadas = new Set();

function dibujarDispositivo(d) {
  const punto = el('circle', { class: 'disp off', r: 7, cx: MAPA.x(d.lon), cy: MAPA.y(d.lat), tabindex: 0, role: 'button' }, capaPuntos);
  el('title', {}, punto).textContent = `${d.nombre} · ${d.ciudad}`;
  punto.addEventListener('click', () => seleccionar(d.id));
  punto.addEventListener('keydown', (e) => { if (e.key === 'Enter') seleccionar(d.id); });
  const pos = d.ciudad in MAPA.etiquetas ? MAPA.etiquetas[d.ciudad] : [10, 4, 'start'];
  if (pos && !ciudadesDibujadas.has(d.ciudad)) {
    ciudadesDibujadas.add(d.ciudad);
    el('text', { class: 'ciudad', x: MAPA.x(d.lon) + pos[0], y: MAPA.y(d.lat) + pos[1], 'text-anchor': pos[2] }, capaEtiquetas).textContent = d.ciudad;
  }
  return punto;
}

function mostrarEpicentro(lat, lon) {
  capaOndas.replaceChildren();
  const cx = MAPA.x(lon), cy = MAPA.y(lat);
  for (let i = 0; i < 3; i++) {
    const c = el('circle', { class: 'onda', cx, cy, r: 8 }, capaOndas);
    el('animate', { attributeName: 'r', from: 8, to: 120, dur: '3s', begin: `${i}s`, repeatCount: 'indefinite' }, c);
    el('animate', { attributeName: 'opacity', from: .9, to: 0, dur: '3s', begin: `${i}s`, repeatCount: 'indefinite' }, c);
  }
  el('circle', { class: 'epi', cx, cy, r: 6 }, capaOndas);
  clearTimeout(mostrarEpicentro.t);
  mostrarEpicentro.t = setTimeout(() => capaOndas.replaceChildren(), 60_000);
}

/* ---------- gráfica ---------- */
const grafica = window.Chart ? new Chart($('grafica'), {
  type: 'line',
  data: {
    labels: Array(HISTORIA).fill(''),
    datasets: [
      { label: 'Aceleración |a| (g)', data: Array(HISTORIA).fill(null), borderColor: '#1b7867', borderWidth: 2, pointRadius: 0, tension: .25 },
      { label: 'Umbral', data: Array(HISTORIA).fill(estado.umbral), borderColor: '#e2a33a', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0 },
    ],
  },
  options: {
    animation: false, maintainAspectRatio: false, responsive: true,
    scales: { x: { display: false }, y: { min: 0, suggestedMax: .3, ticks: { callback: (v) => v + ' g' } } },
    plugins: { legend: { labels: { boxWidth: 12 } } },
  },
}) : null;
if (!grafica) $('gSub').textContent = 'No se pudo cargar Chart.js (ejecuta npm install)';

function actualizarGrafica() {
  if (!grafica || !estado.seleccionado) return;
  const h = historia.get(estado.seleccionado) || [];
  const datos = Array(HISTORIA - h.length).fill(null).concat(h);
  const d = estado.dispositivos.get(estado.seleccionado);
  grafica.data.datasets[0].data = datos;
  grafica.data.datasets[0].borderColor = d?.datos.enAlerta ? '#cf4d27' : '#1b7867';
  grafica.data.datasets[1].data = Array(HISTORIA).fill(estado.umbral);
  grafica.update('none');
}

/* ---------- render ---------- */
function claseEstado(d) { return !d.enLinea ? 'off' : d.enAlerta ? 'al' : 'ok'; }
const textoEstado = { ok: 'En línea', off: 'Desconectado', al: 'ALERTA' };

function renderDispositivo(id) {
  const d = estado.dispositivos.get(id);
  const c = claseEstado(d.datos);
  d.punto.setAttribute('class', `disp ${c}${id === estado.seleccionado ? ' sel' : ''}`);
  d.fila.classList.toggle('sel', id === estado.seleccionado);
  d.etiqueta.className = `etq ${c}`;
  d.etiqueta.textContent = textoEstado[c];
  d.celdaM.textContent = d.datos.enLinea ? fmt(d.m) : '–';
}

function renderKpis() {
  const todos = [...estado.dispositivos.values()].map((d) => d.datos);
  $('kEnLinea').textContent = `${todos.filter((d) => d.enLinea).length} / ${todos.length}`;
  $('kAlerta').textContent = todos.filter((d) => d.enLinea && d.enAlerta).length;
  $('kEventos').textContent = estado.eventos.length;
  $('kUmbral').textContent = `${fmt(estado.umbral, 2)} g`;
}

function crearFila(d) {
  const tr = document.createElement('tr');
  const celdas = [d.nombre, d.ciudad, '', ''].map((t) => { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); return td; });
  const etiqueta = document.createElement('span');
  celdas[2].appendChild(etiqueta);
  celdas[3].className = 'num';
  tr.addEventListener('click', () => seleccionar(d.id));
  $('tablaDispositivos').appendChild(tr);
  return { fila: tr, etiqueta, celdaM: celdas[3] };
}

function renderRegistro(lista, elemento, texto, vacio) {
  elemento.replaceChildren();
  if (!lista.length) {
    const li = document.createElement('li'); li.className = 'vacio'; li.textContent = vacio; elemento.appendChild(li); return;
  }
  for (const item of lista.slice(0, 20)) {
    const li = document.createElement('li');
    const a = document.createElement('span'); a.textContent = texto(item);
    const b = document.createElement('span'); b.textContent = hora(item.fecha);
    li.append(a, b);
    elemento.appendChild(li);
  }
}
const renderEventos = () => renderRegistro(estado.eventos, $('listaEventos'), (e) => `${e.nombre} (${e.ciudad}) · ${fmt(e.pga, 2)} g`, 'Sin eventos todavía');
const renderAlertas = () => renderRegistro(estado.alertas, $('listaAlertas'), (a) => `Sismo confirmado por ${a.dispositivos} dispositivos · PGA máx ${fmt(a.pga_max, 2)} g`, 'Sin alertas todavía');

function seleccionar(id) {
  const anterior = estado.seleccionado;
  estado.seleccionado = id;
  if (anterior) renderDispositivo(anterior);
  renderDispositivo(id);
  const d = estado.dispositivos.get(id).datos;
  $('gTitulo').textContent = d.nombre;
  $('gSub').textContent = `${d.ciudad} · ${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`;
  actualizarGrafica();
}

let ocultarAviso;
function mostrarAviso(a) {
  $('avisoTexto').textContent = `Confirmado por ${a.dispositivos} dispositivos · aceleración máxima ${fmt(a.pga_max, 2)} g · ${hora(a.fecha || new Date().toISOString())}`;
  $('aviso').hidden = false;
  clearTimeout(ocultarAviso);
  ocultarAviso = setTimeout(() => { $('aviso').hidden = true; }, 30_000);
}

/* ---------- sesión ---------- */
const irAlLogin = () => location.replace('/login.html');
let usuarioActual = null;

async function verificarSesion() {
  const r = await fetch('/api/sesion');
  if (!r.ok) { irAlLogin(); return null; }
  usuarioActual = (await r.json()).usuario;
  $('nombreUsuario').textContent = usuarioActual.nombre;
  $('rolUsuario').textContent = usuarioActual.rol === 'admin' ? 'Administrador' : 'Operador';
  document.body.hidden = false;
  return usuarioActual;
}

$('salir').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  irAlLogin();
});

/* ---------- datos iniciales ---------- */
async function cargar() {
  const r = await fetch('/api/estado');
  if (r.status === 401) return irAlLogin();
  const datos = await r.json();
  estado.umbral = datos.config.umbral;
  estado.eventos = datos.eventos;
  estado.alertas = datos.alertas;
  // La simulación solo la ve un administrador y solo si el modo simulación está activo.
  $('cajaSimulacion').hidden = !(datos.config.modoSimulacion && usuarioActual?.rol === 'admin');
  for (const d of datos.dispositivos) {
    if (!estado.dispositivos.has(d.id)) {
      estado.dispositivos.set(d.id, { datos: d, m: null, punto: dibujarDispositivo(d), ...crearFila(d) });
    }
    estado.dispositivos.get(d.id).datos = d;
    renderDispositivo(d.id);
  }
  if (!estado.seleccionado && datos.dispositivos.length) seleccionar(datos.dispositivos[0].id);
  renderEventos(); renderAlertas(); renderKpis();
}

/* ---------- tiempo real ---------- */
function conectar() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/panel`);
  ws.onopen = () => { $('conexion').textContent = 'En vivo'; $('conexion').classList.remove('caido'); cargar(); };
  ws.onclose = async (e) => {
    $('conexion').textContent = 'Sin conexión · reintentando';
    $('conexion').classList.add('caido');
    // Si la sesión venció o se cerró, volver al inicio de sesión en lugar de reintentar.
    const sigue = e.code !== 4401 && (await fetch('/api/sesion').then((r) => r.ok).catch(() => true));
    if (sigue) setTimeout(conectar, 2000); else irAlLogin();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.tipo) {
      case 'lecturas': {
        const enviados = new Set();
        for (const l of msg.datos) {
          const d = estado.dispositivos.get(l.id);
          if (!d) continue;
          enviados.add(l.id);
          Object.assign(d, { m: l.m, x: l.x, y: l.y, z: l.z });
          d.datos.enAlerta = l.alerta;
          const h = historia.get(l.id) || [];
          h.push(l.m); if (h.length > HISTORIA) h.shift();
          historia.set(l.id, h);
          renderDispositivo(l.id);
        }
        const s = estado.dispositivos.get(estado.seleccionado);
        if (s && enviados.has(estado.seleccionado)) {
          $('vx').textContent = fmt(s.x); $('vy').textContent = fmt(s.y); $('vz').textContent = fmt(s.z); $('vm').textContent = fmt(s.m);
        }
        actualizarGrafica(); renderKpis();
        break;
      }
      case 'dispositivo': {
        const d = estado.dispositivos.get(msg.dispositivo.id);
        if (d) { d.datos = msg.dispositivo; renderDispositivo(d.datos.id); renderKpis(); }
        break;
      }
      case 'evento':
        estado.eventos.unshift(msg.evento);
        if (estado.dispositivos.has(msg.dispositivo.id)) { estado.dispositivos.get(msg.dispositivo.id).datos = msg.dispositivo; renderDispositivo(msg.dispositivo.id); }
        renderEventos(); renderKpis();
        break;
      case 'alerta':
        estado.alertas.unshift(msg.alerta);
        mostrarAviso(msg.alerta);
        mostrarEpicentro(msg.alerta.lat, msg.alerta.lon);
        renderAlertas();
        break;
      case 'alerta_actualizada': {
        const a = estado.alertas.find((x) => x.id === msg.alerta.id);
        if (a) { Object.assign(a, msg.alerta); renderAlertas(); if (!$('aviso').hidden) mostrarAviso(a); }
        break;
      }
    }
  };
}

/* ---------- simulación ---------- */
$('magnitud').addEventListener('input', (e) => { $('magTxt').textContent = Number(e.target.value).toFixed(1).replace('.', ','); });
$('formSimulacion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const [lat, lon] = $('epicentro').value.split(',').map(Number);
  const boton = e.submitter; boton.disabled = true;
  try {
    const r = await fetch('/api/simulacion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon, magnitud: Number($('magnitud').value) }) });
    const datos = await r.json();
    if (r.status === 401) return irAlLogin();
    $('simEstado').textContent = r.ok ? `Sismo enviado a ${datos.enviados} dispositivos. Observa el mapa y la gráfica.` : `Error: ${datos.error}`;
  } catch {
    $('simEstado').textContent = 'No se pudo contactar al servidor.';
  } finally {
    setTimeout(() => { boton.disabled = false; }, 3000);
  }
});

verificarSesion().then((u) => { if (u) conectar(); });
