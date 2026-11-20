/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/ui.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Utilidades compartidas del panel: navegación entre secciones, notificaciones,
 *           ventanas de confirmación, números animados, tema claro/oscuro, sonido, reloj,
 *           peticiones al servidor y medidor de fuerza de contraseñas.
 */
'use strict';

window.UI = (() => {
  const $ = (id) => document.getElementById(id);
  // Todo texto que viene del servidor se escapa antes de insertarlo en la página (evita XSS).
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = (v, d = 3) => (v == null ? '–' : (v < 0 ? '−' : '') + Math.abs(Number(v)).toFixed(d).replace('.', ','));
  const ZONA = { timeZone: 'America/Bogota' };
  const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { ...ZONA, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
  const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { ...ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const iniciales = (nombre) => String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** «hace 3 min», «hace 2 h»… */
  function haceCuanto(iso) {
    if (!iso) return 'nunca';
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 45) return 'hace un momento';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86_400)} d`;
  }

  /* ---------- peticiones ---------- */
  async function pedir(url, metodo = 'GET', cuerpo) {
    const r = await fetch(url, {
      method: metodo,
      headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    if (r.status === 401) location.replace('/login.html');
    return { ok: r.ok, status: r.status, datos: await r.json().catch(() => ({})) };
  }

  /* ---------- notificaciones ---------- */
  const COLORES = { ok: 'var(--ok)', error: 'var(--coral)', alerta: 'var(--coral)', info: 'var(--teal)', aviso: 'var(--ambar)' };
  function toast(texto, tipo = 'info', ms = 4500) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--c', COLORES[tipo] || COLORES.info);
    t.textContent = texto;
    $('toasts').appendChild(t);
    const quitar = () => { t.classList.add('sale'); setTimeout(() => t.remove(), 300); };
    setTimeout(quitar, ms);
    t.addEventListener('click', quitar);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }

  /* ---------- diálogos ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cerrar]');
    if (b) b.closest('dialog').close();
  });
  /** Ventana de confirmación propia (no usa confirm() del navegador). Devuelve una promesa. */
  function confirmar(titulo, texto, boton = 'Confirmar') {
    const d = $('dConfirmar');
    $('dConfirmarTitulo').textContent = titulo;
    $('dConfirmarTexto').textContent = texto;
    $('dConfirmarSi').textContent = boton;
    d.showModal();
    return new Promise((resolver) => {
      const si = () => { d.close(); resolver(true); };
      $('dConfirmarSi').addEventListener('click', si, { once: true });
      d.addEventListener('close', () => { $('dConfirmarSi').removeEventListener('click', si); resolver(false); }, { once: true });
    });
  }

  /* ---------- números animados ---------- */
  function contar(el, valor, decimales = 0) {
    if (!el) return;
    const destino = Number(valor) || 0;
    const inicio = Number(el.dataset.valor || 0);
    el.dataset.valor = destino;
    const pintar = (v) => { el.textContent = decimales ? g(v, decimales) : Math.round(v).toLocaleString('es-CO'); };
    if (reducido || inicio === destino) return pintar(destino);
    const t0 = performance.now(), dur = 700;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      pintar(inicio + (destino - inicio) * e);
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  /* ---------- navegación entre secciones ---------- */
  const vistas = new Map(); // hash -> { id, titulo, miga, alMostrar, admin }
  let actual = null;
  let usuario = null;
  function registrar(hash, o) { vistas.set(hash, o); }
  function ir(hash) {
    let v = vistas.get(hash);
    if (!v || (v.admin && usuario?.rol !== 'admin')) { hash = 'monitoreo'; v = vistas.get(hash); }
    const cambio = actual !== hash;
    actual = hash;
    for (const o of vistas.values()) $(o.id).hidden = o !== v;
    document.querySelectorAll('.lateral nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.vista === v.id));
    $('tituloVista').textContent = v.titulo;
    $('miga').textContent = v.miga;
    document.title = `Vigía · ${v.titulo}`;
    cerrarMenu();
    if (cambio) window.scrollTo({ top: 0 });
    v.alMostrar?.();
  }
  window.addEventListener('hashchange', () => ir(location.hash.slice(1)));
  const cerrarMenu = () => { $('lateral').classList.remove('abierto'); $('velo').hidden = true; };
  $('bMenu').addEventListener('click', () => { $('lateral').classList.add('abierto'); $('velo').hidden = false; });
  $('velo').addEventListener('click', cerrarMenu);

  /* ---------- tema claro / oscuro ---------- */
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
  const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  function pintarTema() {
    const oscuro = document.documentElement.dataset.tema === 'oscuro';
    $('bTema').querySelector('use').setAttribute('href', oscuro ? '#i-sol' : '#i-luna');
    $('bTema').title = oscuro ? 'Tema claro' : 'Tema oscuro';
  }
  $('bTema').addEventListener('click', () => {
    const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = nuevo;
    guardar('vigia:tema', nuevo);
    pintarTema();
    document.dispatchEvent(new Event('vigia:tema'));
  });
  pintarTema();
  /** Colores actuales del tema, para las gráficas. */
  function colores() {
    const c = getComputedStyle(document.documentElement);
    const v = (n) => c.getPropertyValue(n).trim();
    return { teal: v('--teal'), coral: v('--coral'), ok: v('--ok'), ambar: v('--ambar'), violeta: v('--violeta'), tinta: v('--tinta'), tenue: v('--tenue'), linea: v('--linea'), superficie: v('--superficie'), off: v('--off') };
  }

  /* ---------- sonido de alerta ---------- */
  let sonido = leer('vigia:sonido') !== 'no';
  function pintarSonido() {
    $('bSonido').setAttribute('aria-pressed', sonido);
    $('bSonido').querySelector('use').setAttribute('href', sonido ? '#i-son' : '#i-mudo');
    $('bSonido').title = sonido ? 'Silenciar alertas' : 'Activar sonido de alertas';
  }
  $('bSonido').addEventListener('click', () => { sonido = !sonido; guardar('vigia:sonido', sonido ? 'si' : 'no'); pintarSonido(); });
  pintarSonido();
  function sirena() {
    if (!sonido) return;
    try {
      const A = new (window.AudioContext || window.webkitAudioContext)(), o = A.createOscillator(), gn = A.createGain(), n = A.currentTime;
      o.type = 'sawtooth'; o.connect(gn); gn.connect(A.destination);
      for (let i = 0; i < 8; i++) { o.frequency.setValueAtTime(880, n + i * .4); o.frequency.linearRampToValueAtTime(560, n + i * .4 + .38); }
      gn.gain.setValueAtTime(.0001, n); gn.gain.exponentialRampToValueAtTime(.05, n + .05); gn.gain.setValueAtTime(.05, n + 3); gn.gain.exponentialRampToValueAtTime(.0001, n + 3.2);
      o.start(n); o.stop(n + 3.25); o.onended = () => A.close();
    } catch { /* el navegador puede bloquear el sonido */ }
  }

  /* ---------- reloj (hora de Colombia) ---------- */
  const reloj = () => { $('reloj').textContent = new Date().toLocaleTimeString('es-CO', { ...ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  reloj(); setInterval(reloj, 1000);

  /* ---------- fuerza de la contraseña ---------- */
  function medirClave(input) {
    const barra = input.closest('form').querySelector('.fuerza i');
    input.addEventListener('input', () => {
      const c = input.value;
      let p = 0;
      if (c.length >= 8) p++; if (c.length >= 12) p++;
      if (/[a-zñ]/i.test(c) && /\d/.test(c)) p++;
      if (/[A-ZÑ]/.test(c) && /[a-zñ]/.test(c)) p++;
      if (/[^a-z0-9ñ]/i.test(c)) p++;
      const col = ['var(--coral)', 'var(--coral)', 'var(--ambar)', 'var(--ambar)', 'var(--ok)', 'var(--ok)'][p];
      barra.style.width = c ? `${Math.max(12, p * 20)}%` : '0';
      barra.style.background = col;
    });
  }

  /** Bloquea el botón mientras se envía un formulario y muestra el error si lo hay. */
  async function enviando(form, accion) {
    const boton = form.querySelector('button[type=submit]');
    const error = form.querySelector('.error');
    boton.disabled = true;
    if (error) error.textContent = '';
    try { await accion((msg) => { if (error) { error.textContent = msg; form.classList.remove('agitar'); void form.offsetWidth; form.classList.add('agitar'); } }); }
    catch { if (error) error.textContent = 'No se pudo contactar al servidor.'; }
    finally { boton.disabled = false; }
  }

  return {
    $, esc, g, fechaHora, hora, haceCuanto, iniciales, pedir, toast, confirmar, contar, registrar, ir, colores, sirena, medirClave, enviando,
    get usuario() { return usuario; },
    set usuario(u) { usuario = u; },
    get vista() { return actual; },
  };
})();
