/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/administracion.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Secciones de administración del panel: estadísticas con gráficas (Chart.js),
 *           comunicados y simulacros para los clientes, usuarios y roles, bitácora de auditoría
 *           y cambio de la propia contraseña.
 */
'use strict';

(() => {
  const { $, esc, g, fechaHora, haceCuanto, pedir } = UI;
  const graficas = {};

  /* ============================== estadísticas ============================== */
  let ultimaEst = null;
  async function cargarEstadisticas() {
    const r = await pedir('/api/estadisticas');
    if (!r.ok) return;
    ultimaEst = r.datos;
    pintarEstadisticas();
  }
  function grafica(id, config) {
    graficas[id]?.destroy();
    graficas[id] = new Chart($(id), config);
  }
  function pintarEstadisticas() {
    const e = ultimaEst;
    if (!e || !window.Chart) return;
    const c = UI.colores();
    const t = e.totales;
    const respondieron = t.bien + t.ayuda;
    $('eCifras').innerHTML = [
      ['Eventos detectados', t.eventos.toLocaleString('es-CO'), 'en toda la historia'],
      ['Sismos confirmados', t.alertas, t.pgaMaxima ? `máx. ${g(t.pgaMaxima, 2)} g` : 'sin alertas'],
      ['Hogares', t.clientes, `${t.contactos} contactos de emergencia`],
      ['Respondieron «bien»', respondieron ? `${Math.round((t.bien / respondieron) * 100)} %` : '–', `${respondieron} respuestas`],
      ['Ayuda atendida', t.ayuda ? `${t.atendidas} / ${t.ayuda}` : '–', 'solicitudes'],
      ['Tiempo de atención', t.minutosAtencion != null ? `${g(t.minutosAtencion, 1)} min` : '–', 'promedio'],
    ].map(([n, v, s]) => `<div class="cifra"><span>${n}</span><strong>${v}</strong><small>${s}</small></div>`).join('');

    const comun = { maintainAspectRatio: false, responsive: true, animation: { duration: 900, easing: 'easeOutQuart' }, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } } } };
    const ejes = { grid: { color: c.linea }, border: { display: false }, ticks: { precision: 0 } };
    const dias = e.dias.map((d) => new Date(`${d.dia}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }));
    grafica('gDias', {
      type: 'bar',
      data: { labels: dias, datasets: [
        { type: 'bar', label: 'Eventos detectados', data: e.dias.map((d) => d.eventos), backgroundColor: c.teal, borderRadius: 6, maxBarThickness: 34, order: 2 },
        { type: 'line', label: 'Sismos confirmados', data: e.dias.map((d) => d.alertas), borderColor: c.coral, backgroundColor: c.coral, tension: .35, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, order: 1 },
      ] },
      options: { ...comun, scales: { x: { ...ejes, grid: { display: false } }, y: { ...ejes, beginAtZero: true } } },
    });
    const dist = e.distribucion;
    // Una dona sin datos se muestra como un anillo gris con la leyenda «Sin datos».
    const dona = (etiquetas, datos, colores) => (datos.some((x) => x > 0)
      ? { labels: etiquetas, datasets: [{ data: datos, backgroundColor: colores, borderColor: c.superficie, borderWidth: 3, hoverOffset: 10 }] }
      : { labels: ['Sin datos todavía'], datasets: [{ data: [1], backgroundColor: [c.linea], borderColor: c.superficie, borderWidth: 3 }] });
    grafica('gIntensidad', {
      type: 'doughnut',
      data: dona(['Leve (< 0,2 g)', 'Moderado (0,2–0,3 g)', 'Fuerte (0,3–0,5 g)', 'Severo (≥ 0,5 g)'], [dist.leve, dist.moderado, dist.fuerte, dist.severo], [c.ok, c.ambar, c.coral, '#8c1d06']),
      options: { ...comun, cutout: '64%', plugins: { ...comun.plugins, legend: { ...comun.plugins.legend, position: 'right' } } },
    });
    grafica('gCiudades', {
      type: 'bar',
      data: { labels: e.ciudades.map((x) => x.ciudad), datasets: [{ label: 'Eventos', data: e.ciudades.map((x) => x.n), backgroundColor: e.ciudades.map((_, i) => (i === 0 ? c.coral : c.violeta)), borderRadius: 6, maxBarThickness: 22 }] },
      options: { ...comun, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ...ejes, beginAtZero: true }, y: { grid: { display: false }, border: { display: false } } } },
    });
    grafica('gRespuestas', {
      type: 'doughnut',
      data: dona(['Estoy bien', 'Necesito ayuda (atendida)', 'Necesito ayuda (pendiente)'], [t.bien, t.atendidas, t.ayuda - t.atendidas], [c.ok, c.teal, c.coral]),
      options: { ...comun, cutout: '64%', plugins: { ...comun.plugins, legend: { ...comun.plugins.legend, position: 'right' } } },
    });
    const items = [
      ...e.red.desconectados.map((d) => `<div class="salud-item mal"><svg><use href="#i-red"/></svg><div><b>${esc(d.nombre)}</b> desconectado<small>${esc(d.ciudad)} · última conexión ${haceCuanto(d.ultimaConexion)}</small></div></div>`),
      ...e.red.bateriaBaja.map((d) => `<div class="salud-item amb"><svg><use href="#i-bat"/></svg><div><b>${esc(d.nombre)}</b> con batería baja<small>${d.bateria} % · programar visita de mantenimiento</small></div></div>`),
    ];
    $('eSalud').innerHTML = items.length ? items.join('') : `<div class="salud-item bien"><svg><use href="#i-escudo"/></svg><div><b>Toda la red está sana</b><small>${e.red.enLinea} de ${e.red.total} dispositivos en línea y con batería suficiente</small></div></div>`;
  }
  document.addEventListener('vigia:tema', () => { if (UI.vista === 'estadisticas') pintarEstadisticas(); });

  /* ============================== comunicados ============================== */
  const TIPOS = { informativo: ['Informativo', 'var(--teal)'], mantenimiento: ['Mantenimiento', 'var(--ambar)'], simulacro: ['Simulacro', 'var(--violeta)'] };
  const fc = $('fComunicado');
  function previa() {
    const tipo = fc.tipo.value;
    const [nombre, col] = TIPOS[tipo];
    $('previa').style.setProperty('--c', col);
    $('previa').innerHTML = `<p class="tipo">${nombre}</p><h3>${esc(fc.titulo.value || 'Título del comunicado')}</h3><p>${esc(fc.mensaje.value || 'Aquí aparecerá el mensaje para los hogares.')}</p>`;
    $('cuentaMsg').textContent = `${fc.mensaje.value.length} / 600`;
    $('notaSimulacro').hidden = tipo !== 'simulacro';
  }
  fc.addEventListener('input', previa);
  previa();
  fc.addEventListener('submit', (e) => {
    e.preventDefault();
    UI.enviando(fc, async (error) => {
      const d = Object.fromEntries(new FormData(fc));
      const r = await pedir('/api/comunicados', 'POST', d);
      if (!r.ok) return error(r.datos.error || 'No se pudo enviar.');
      UI.toast(`Comunicado enviado a ${r.datos.destinatarios} ${r.datos.destinatarios === 1 ? 'hogar' : 'hogares'}.`, 'ok');
      fc.reset(); previa();
      cargarComunicados();
    });
  });
  async function cargarComunicados() {
    $('cajaComunicado').hidden = UI.usuario?.rol !== 'admin';
    $('cajaComunicado').nextElementSibling.hidden = UI.usuario?.rol !== 'admin';
    const r = await pedir('/api/comunicados');
    if (!r.ok) return;
    const { comunicados, clientes } = r.datos;
    $('cResumen').textContent = `${comunicados.length} enviados · ${clientes} hogares registrados`;
    $('listaComunicados').innerHTML = comunicados.length ? comunicados.map((c, i) => {
      const [nombre, col] = TIPOS[c.tipo];
      return `<article class="comunicado" style="--c:${col};animation-delay:${i * 40}ms">
        <div class="pie"><span class="etq plano" style="background:color-mix(in srgb, ${col} 14%, transparent);color:${col}">${nombre}</span><span>${fechaHora(c.fecha)}</span></div>
        <h3>${esc(c.titulo)}</h3><p>${esc(c.mensaje)}</p>
        <div class="lectura"><i data-ancho="${clientes ? Math.min(100, (c.leidos / clientes) * 100) : 0}"></i></div>
        <div class="pie"><span>${esc(c.ciudad ? `Hogares de ${c.ciudad}` : 'Todos los hogares')} · por ${esc(c.autor)}</span><span>${c.leidos} ${c.leidos === 1 ? 'lectura' : 'lecturas'}</span></div>
      </article>`;
    }).join('') : `<div class="vacio-grande"><svg><use href="#i-mega"/></svg><p>Todavía no se han enviado comunicados.</p></div>`;
    requestAnimationFrame(() => document.querySelectorAll('.lectura i').forEach((i) => { i.style.width = i.dataset.ancho + '%'; }));
  }

  /* ============================== usuarios ============================== */
  let editando = null;
  const fu = $('fUsuario');
  async function cargarUsuarios() {
    const r = await pedir('/api/usuarios');
    if (!r.ok) return;
    $('tUsuarios').innerHTML = `<thead><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th>Último acceso</th><th></th></tr></thead><tbody>${r.datos.usuarios.map((u, i) => `<tr style="animation-delay:${i * 25}ms">
      <td><span class="usuario-celda"><span class="avatar">${esc(UI.iniciales(u.nombre))}</span><span><b>${esc(u.nombre)}</b><small>@${esc(u.usuario)}${u.usuario === UI.usuario.usuario ? ' · tú' : ''}</small></span></span></td>
      <td><span class="etq ${u.rol === 'admin' ? 'vio' : 'ok'}">${u.rol === 'admin' ? 'Administrador' : 'Operador'}</span></td>
      <td>${fechaHora(u.creado)}</td><td>${u.ultimoAcceso ? haceCuanto(u.ultimoAcceso) : '<span class="tenue">Nunca</span>'}</td>
      <td><div class="acciones-fila">
        <button type="button" class="boton secundario mini" data-editar='${esc(JSON.stringify({ usuario: u.usuario, nombre: u.nombre, rol: u.rol }))}'>Editar</button>
        ${u.usuario === UI.usuario.usuario ? '' : `<button type="button" class="boton fantasma mini" data-eliminar="${esc(u.usuario)}">Eliminar</button>`}
      </div></td></tr>`).join('')}</tbody>`;
  }
  function abrirUsuario(u) {
    editando = u;
    fu.reset();
    fu.querySelector('.error').textContent = '';
    fu.querySelector('.fuerza i').style.width = '0';
    $('dUsuarioTitulo').textContent = u ? `Editar a ${u.nombre}` : 'Nuevo usuario';
    $('etqClave').textContent = u ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña';
    fu.usuario.disabled = !!u;
    if (u) { fu.usuario.value = u.usuario; fu.nombre.value = u.nombre; fu.rol.value = u.rol; }
    $('dUsuario').showModal();
    (u ? fu.nombre : fu.usuario).focus();
  }
  $('bNuevoUsuario').addEventListener('click', () => abrirUsuario(null));
  UI.medirClave(fu.clave);
  fu.addEventListener('submit', (e) => {
    e.preventDefault();
    UI.enviando(fu, async (error) => {
      const d = Object.fromEntries(new FormData(fu));
      let r;
      if (editando) {
        const cambios = { nombre: d.nombre, rol: d.rol };
        if (d.clave) cambios.clave = d.clave;
        r = await pedir(`/api/usuarios/${encodeURIComponent(editando.usuario)}`, 'PATCH', cambios);
      } else {
        r = await pedir('/api/usuarios', 'POST', d);
      }
      if (!r.ok) return error(r.datos.error || 'No se pudo guardar.');
      $('dUsuario').close();
      UI.toast(editando ? 'Usuario actualizado.' : `Usuario @${r.datos.usuario.usuario} creado.`, 'ok');
      cargarUsuarios();
    });
  });
  document.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-editar]');
    if (ed) return abrirUsuario(JSON.parse(ed.dataset.editar));
    const el = e.target.closest('[data-eliminar]');
    if (!el) return;
    if (!(await UI.confirmar('Eliminar usuario', `@${el.dataset.eliminar} ya no podrá entrar al panel y se cerrarán sus sesiones abiertas. La bitácora conserva su historial.`, 'Eliminar'))) return;
    const r = await pedir(`/api/usuarios/${encodeURIComponent(el.dataset.eliminar)}`, 'DELETE');
    UI.toast(r.ok ? 'Usuario eliminado.' : r.datos.error || 'No se pudo eliminar.', r.ok ? 'ok' : 'error');
    if (r.ok) cargarUsuarios();
  });

  /* ============================== bitácora ============================== */
  const ICONOS = {
    login: ['i-salir', 'var(--ok)'], logout: ['i-salir', 'var(--tenue)'], login_fallido: ['i-x', 'var(--ambar)'], bloqueo: ['i-escudo', 'var(--coral)'],
    simulacion: ['i-onda', 'var(--coral)'], desvincular: ['i-red', 'var(--ambar)'], atender_ayuda: ['i-sos', 'var(--teal)'],
    usuario_creado: ['i-users', 'var(--violeta)'], usuario_modificado: ['i-users', 'var(--violeta)'], usuario_eliminado: ['i-users', 'var(--coral)'],
    cambio_clave: ['i-llave', 'var(--teal)'], comunicado: ['i-mega', 'var(--violeta)'], prueba_remota: ['i-campana', 'var(--teal)'],
  };
  let paginaB = 1, accionesCargadas = false;
  $('fBitacora').addEventListener('submit', (e) => { e.preventDefault(); cargarBitacora(1); });
  $('fBitacora').accion.addEventListener('change', () => cargarBitacora(1));
  $('bAnterior').onclick = () => cargarBitacora(paginaB - 1);
  $('bSiguiente').onclick = () => cargarBitacora(paginaB + 1);
  async function cargarBitacora(n = 1) {
    const p = new URLSearchParams({ pagina: n });
    for (const [k, v] of new FormData($('fBitacora'))) if (v.trim()) p.set(k, v.trim());
    const r = await pedir('/api/auditoria?' + p);
    if (!r.ok) return UI.toast(r.datos.error || 'No se pudo cargar la bitácora.', 'error');
    const { total, items, acciones, porPagina } = r.datos;
    paginaB = r.datos.pagina;
    if (!accionesCargadas) {
      $('fBitacora').accion.insertAdjacentHTML('beforeend', Object.entries(acciones).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
      accionesCargadas = true;
    }
    $('listaBitacora').innerHTML = items.length ? items.map((i, k) => {
      const [ico, col] = ICONOS[i.accion] || ['i-reloj', 'var(--tenue)'];
      return `<li style="animation-delay:${k * 15}ms"><span class="ico" style="--c:${col}"><svg><use href="#${ico}"/></svg></span>
        <div><b>${esc(acciones[i.accion] || i.accion)}</b> · <span>@${esc(i.usuario)}</span><p>${esc(i.detalle)}${i.ip ? ` · IP ${esc(i.ip.replace('::ffff:', ''))}` : ''}</p></div>
        <time datetime="${esc(i.fecha)}">${fechaHora(i.fecha)}</time></li>`;
    }).join('') : `<li><div class="vacio-grande" style="grid-column:1/-1"><p>No hay registros con esos filtros.</p></div></li>`;
    const fin = Math.min(total, paginaB * porPagina);
    $('bPagina').textContent = total ? `${(paginaB - 1) * porPagina + 1}–${fin} de ${total}` : '';
    $('bAnterior').disabled = paginaB <= 1;
    $('bSiguiente').disabled = fin >= total;
  }

  /* ============================== mi cuenta ============================== */
  const fcu = $('fCuenta');
  UI.medirClave(fcu.nueva);
  $('bCuenta').addEventListener('click', () => { fcu.reset(); fcu.querySelector('.error').textContent = ''; fcu.querySelector('.fuerza i').style.width = '0'; $('dCuenta').showModal(); });
  fcu.addEventListener('submit', (e) => {
    e.preventDefault();
    UI.enviando(fcu, async (error) => {
      const d = Object.fromEntries(new FormData(fcu));
      if (d.nueva !== d.repetida) return error('Las contraseñas nuevas no coinciden.');
      const r = await pedir('/api/cuenta/clave', 'POST', { actual: d.actual, nueva: d.nueva });
      if (!r.ok) return error(r.datos.error || 'No se pudo cambiar.');
      $('dCuenta').close();
      UI.toast('Tu contraseña se cambió correctamente.', 'ok');
    });
  });

  /* ============================== registro de secciones ============================== */
  UI.registrar('estadisticas', { id: 'vEstadisticas', titulo: 'Estadísticas de la red', miga: 'Operación', alMostrar: cargarEstadisticas });
  UI.registrar('comunicados', { id: 'vComunicados', titulo: 'Comunicados a los hogares', miga: 'Red y clientes', alMostrar: cargarComunicados });
  UI.registrar('usuarios', { id: 'vUsuarios', titulo: 'Usuarios del panel', miga: 'Administración', admin: true, alMostrar: cargarUsuarios });
  UI.registrar('bitacora', { id: 'vBitacora', titulo: 'Bitácora de auditoría', miga: 'Administración', admin: true, alMostrar: () => cargarBitacora(1) });

  document.addEventListener('vigia:mensaje', (e) => {
    const t = e.detail.tipo;
    if (UI.vista === 'estadisticas' && (t === 'alerta' || t === 'respuesta' || t === 'solicitudes')) cargarEstadisticas();
  });
})();
