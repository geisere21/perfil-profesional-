/* Landing de Geiser Elligon · comportamiento.
   Todo el contenido existe sin este archivo. Esto suma: panel de WhatsApp,
   medición sin datos personales, videos diferidos y animación. */
(function () {
  'use strict';
  var doc = document;
  var raiz = doc.documentElement;
  var cfg = JSON.parse(doc.getElementById('config-sitio').textContent);
  var quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conexion = navigator.connection || {};
  var ahorro = conexion.saveData === true || /(^|-)2g$/.test(conexion.effectiveType || '');
  raiz.classList.add('js');

  /* ── Medición ───────────────────────────────────────────────
     Sin cookies ni identificadores. Se arma la cola desde el principio
     y se envía después de `load`. */
  var cola = [];
  var cargada = false;
  var origen = calcularOrigen();

  function calcularOrigen() {
    var p = new URLSearchParams(location.search);
    var etiqueta = (p.get('utm_source') || p.get('o') || '').toLowerCase();
    var porEtiqueta = { instagram: 'instagram', ig: 'instagram', linkedin: 'linkedin', li: 'linkedin', whatsapp: 'whatsapp', wa: 'whatsapp', 'web-anterior': 'web_anterior' };
    if (porEtiqueta[etiqueta]) return porEtiqueta[etiqueta];
    var host = '';
    try { host = new URL(doc.referrer).hostname; } catch (e) { /* sin referencia */ }
    if (!host || host === location.hostname) return etiqueta ? 'otro' : 'directo';
    var reglas = [
      [/(^|\.)instagram\.com$/, 'instagram'],
      [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
      [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
      [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, 'asistente_ia'],
      [/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|ecosia\.org|search\.brave\.com)$/, 'buscador'],
      [/^geisere21\.github\.io$/, 'web_anterior']
    ];
    for (var i = 0; i < reglas.length; i++) if (reglas[i][0].test(host)) return reglas[i][1];
    return 'otro';
  }

  function despachar(datos) {
    var cuerpo = JSON.stringify(datos);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(cfg.medicion.endpoint, new Blob([cuerpo], { type: 'application/json' }))) return;
    } catch (e) { /* sigue con fetch */ }
    try { fetch(cfg.medicion.endpoint, { method: 'POST', body: cuerpo, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {}); } catch (e) { /* nada */ }
  }

  function medir(tipo, extra) {
    if (!cfg.medicion.endpoint || cfg.medicion.eventos.indexOf(tipo) < 0) return;
    var datos = { tipo: tipo, origen: origen };
    if (extra) for (var k in extra) if (extra[k]) datos[k] = extra[k];
    if (cargada) despachar(datos); else cola.push(datos);
  }

  window.addEventListener('load', function () {
    cargada = true;
    medir('visita');
    while (cola.length) despachar(cola.shift());
    var listo = window.requestIdleCallback || function (f) { setTimeout(f, 300); };
    listo(activarVideos);
  });

  var casos = doc.getElementById('casos');
  if (casos && 'IntersectionObserver' in window) {
    var vistoCasos = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { medir('casos_vistos'); vistoCasos.disconnect(); }
    }, { threshold: 0.15 });
    vistoCasos.observe(casos);
  }

  doc.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    if (a.getAttribute('data-evento') === 'ver_casos') medir('ver_casos');
    if (a.getAttribute('data-evento') === 'correo') medir('correo');
  });

  /* ── Panel de WhatsApp ─────────────────────────────────────── */
  var panel = doc.getElementById('panel-wa');
  if (panel && typeof panel.showModal === 'function' && cfg.whatsapp) {
    var abrir = doc.getElementById('panel-wa-abrir');
    var directo = doc.getElementById('panel-wa-directo');
    var abridor = null;
    var boton = 'otro';

    var waUrl = function (texto) { return 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent(texto); };
    var valor = function (nombre) { var r = panel.querySelector('input[name="' + nombre + '"]:checked'); return r ? r.value : null; };
    var mensaje = function (lista, v) { for (var i = 0; i < lista.length; i++) if (lista[i].valor === v) return lista[i].mensaje; return ''; };

    var actualizar = function () {
      var q1 = valor('q1'), q2 = valor('q2');
      if (q1 && q2) {
        abrir.href = waUrl(mensaje(cfg.panel.opciones1, q1) + ' ' + mensaje(cfg.panel.opciones2, q2));
        abrir.setAttribute('aria-disabled', 'false');
      } else {
        abrir.href = waUrl(cfg.panel.mensaje_directo);
        abrir.setAttribute('aria-disabled', 'true');
      }
    };

    var abrirPanel = function (a) {
      abridor = a;
      boton = a.getAttribute('data-wa') || 'otro';
      panel.querySelectorAll('input[type="radio"]').forEach(function (r) { r.checked = false; });
      var q1 = a.getAttribute('data-q1');
      if (q1) { var r1 = panel.querySelector('input[name="q1"][value="' + q1 + '"]'); if (r1) r1.checked = true; }
      actualizar();
      panel.showModal();
      var foco = panel.querySelector(q1 ? 'input[name="q2"]' : 'input[name="q1"]');
      if (foco) foco.focus();
      medir('whatsapp_panel_abierto', { boton: boton });
    };

    doc.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-wa]') : null;
      if (!a || panel.contains(a)) return;
      e.preventDefault();
      abrirPanel(a);
    });

    panel.addEventListener('change', actualizar);

    abrir.addEventListener('click', function (e) {
      if (abrir.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      medir('whatsapp_enviado', { boton: boton, q1: valor('q1'), q2: valor('q2') });
      setTimeout(function () { panel.close(); }, 0);
    });

    directo.addEventListener('click', function () {
      medir('whatsapp_directo', { boton: boton });
      setTimeout(function () { panel.close(); }, 0);
    });

    panel.querySelector('[data-cerrar]').addEventListener('click', function () { panel.close(); });
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.close(); });
    panel.addEventListener('close', function () { if (abridor && abridor.focus) abridor.focus(); });

    // El foco no sale del panel mientras está abierto. Cada grupo de radios es una sola parada.
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var radio = function (n) { return panel.querySelector('input[name="' + n + '"]:checked') || panel.querySelector('input[name="' + n + '"]'); };
      var paradas = [panel.querySelector('[data-cerrar]'), radio('q1'), radio('q2'), abrir, directo];
      var primero = paradas[0], ultimo = paradas[paradas.length - 1];
      var activo = doc.activeElement;
      if (!panel.contains(activo)) { e.preventDefault(); primero.focus(); }
      else if (e.shiftKey && activo === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus(); }
    });
  }

  /* ── Navegación y barra fija ───────────────────────────────── */
  var nav = doc.querySelector('.nav');
  var barra = doc.querySelector('.barra-wa');
  if (nav && !quieto) {
    var ultimoY = window.scrollY;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      var bajando = y > ultimoY + 2;
      var subiendo = y < ultimoY - 2;
      if (bajando && y > 160) nav.classList.add('nav--oculta');
      else if (subiendo || y < 160) nav.classList.remove('nav--oculta');
      ultimoY = y;
    }, { passive: true });
    nav.addEventListener('focusin', function () { nav.classList.remove('nav--oculta'); });
  }
  var acciones = doc.querySelector('.portada__acciones');
  if (barra && acciones && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (e) {
      barra.classList.toggle('barra-wa--oculta', e[0].isIntersecting);
    }).observe(acciones);
  }

  /* ── Videos: después de load, nunca con ahorro de datos ni movimiento reducido ── */
  function activarVideos() {
    if (quieto || ahorro || !('IntersectionObserver' in window)) return;
    doc.querySelectorAll('video[data-src]').forEach(function (v) {
      v.addEventListener('playing', function () { v.classList.add('esta-lista'); }, { once: true });
      new IntersectionObserver(function (e) {
        if (e[0].isIntersecting) {
          if (!v.getAttribute('src')) v.src = v.getAttribute('data-src');
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else if (!v.paused) v.pause();
      }, { rootMargin: '150px 0px' }).observe(v);
    });
  }

  /* ── Animación ─────────────────────────────────────────────── */
  if (quieto || !window.gsap || !window.ScrollTrigger) return;
  var gsap = window.gsap;
  var ST = window.ScrollTrigger;
  gsap.registerPlugin(ST);
  if (window.SplitText) gsap.registerPlugin(window.SplitText);

  var listas = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
  listas.then(iniciar);

  function iniciar() {
    portada();
    cinta();
    casosAnimados();
    collage();
    titulares();
    window.addEventListener('load', function () { ST.refresh(); });
  }

  function portada() {
    var escena = doc.querySelector('.portada__escena');
    var mascara = doc.querySelector('.portada__mascara');
    var texto = doc.querySelector('.portada__texto');
    var velo = doc.querySelector('.portada__velo');
    var letra = doc.querySelector('.portada__i');
    if (!escena || !mascara) return;

    var origenMascara = function () {
      var m = mascara.getBoundingClientRect();
      var r = (letra || mascara).getBoundingClientRect();
      var x = (r.left + r.width / 2 - m.left) / m.width * 100;
      var y = (r.top + r.height * 0.56 - m.top) / m.height * 100;
      return x.toFixed(2) + '% ' + y.toFixed(2) + '%';
    };
    var escala = function () {
      var r = (letra || mascara).getBoundingClientRect();
      var ancho = Math.max(r.width * 0.42, 4);
      var alto = Math.max(r.height * 0.5, 4);
      return Math.max(window.innerWidth / ancho, window.innerHeight / alto) * 1.25;
    };

    var portadaSeccion = escena.parentElement;
    portadaSeccion.classList.add('portada--animada');
    gsap.set(mascara, { transformOrigin: origenMascara() });
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: portadaSeccion, start: 'top top', end: 'bottom bottom', scrub: 0.6,
        invalidateOnRefresh: true,
        onRefreshInit: function () { gsap.set(mascara, { scale: 1, transformOrigin: origenMascara() }); }
      }
    });
    tl.to(texto, { autoAlpha: 0, y: -24, duration: 0.22, ease: 'none' }, 0)
      .to(mascara, { scale: escala, duration: 0.72, ease: 'power2.in' }, 0.08)
      .to(velo, { autoAlpha: 0, duration: 0.25, ease: 'none' }, 0.6)
      .to(mascara, { autoAlpha: 0, duration: 0.12, ease: 'none' }, 0.8);
  }

  function cinta() {
    var pista = doc.querySelector('.cinta__pista');
    if (!pista) return;
    var vuelta = gsap.to(pista, { xPercent: -50, ease: 'none', duration: 32, repeat: -1 });
    vuelta.totalTime(32 * 50);
    ST.create({
      trigger: '.cinta', start: 'top bottom', end: 'max',
      onUpdate: function (self) {
        gsap.to(vuelta, { timeScale: self.direction === 1 ? 1 : -1, duration: 0.5, overwrite: true });
      }
    });
  }

  function contar(el, disparo) {
    var fin = Number(el.getAttribute('data-contar'));
    if (!fin) return;
    var formato = new Intl.NumberFormat('es-VE');
    var estado = { v: 0 };
    el.textContent = '0';
    gsap.to(estado, {
      v: fin, duration: fin > 100 ? 1.6 : 1.1, ease: 'power2.out',
      scrollTrigger: Object.assign({ trigger: el, once: true }, disparo),
      onUpdate: function () { el.textContent = formato.format(Math.round(estado.v)); },
      onComplete: function () { el.textContent = formato.format(fin); }
    });
  }

  function casosAnimados() {
    var seccion = doc.getElementById('casos');
    if (!seccion) return;
    var escenario = seccion.querySelector('.casos__escenario');
    var pista = seccion.querySelector('.casos__pista');
    var tarjetas = seccion.querySelectorAll('.caso');
    var mm = gsap.matchMedia();

    mm.add('(min-width: 1024px)', function () {
      seccion.classList.add('casos--horizontal');
      // Si alguna tarjeta no cabe en la pantalla, se queda apilado: nunca se corta texto.
      var noCabe = Array.prototype.some.call(tarjetas, function (t) {
        var texto = t.querySelector('.caso__texto');
        return texto.scrollHeight > texto.clientHeight + 2;
      });
      if (noCabe) {
        seccion.classList.remove('casos--horizontal');
        tarjetas.forEach(function (t) { t.querySelectorAll('[data-contar]').forEach(function (el) { contar(el, { start: 'top 85%' }); }); });
        return;
      }
      var distancia = function () { return Math.max(0, pista.scrollWidth - window.innerWidth + parseFloat(getComputedStyle(seccion.querySelector('.casos__ventana')).paddingLeft) * 2); };
      var avance = gsap.to(pista, {
        x: function () { return -distancia(); }, ease: 'none',
        scrollTrigger: { trigger: escenario, start: 'top top', end: function () { return '+=' + distancia(); }, pin: true, scrub: 0.7, invalidateOnRefresh: true }
      });
      tarjetas.forEach(function (t) {
        t.querySelectorAll('[data-contar]').forEach(function (el) { contar(el, { containerAnimation: avance, start: 'left 80%' }); });
      });
      // Si algo dentro de una tarjeta recibe foco, la página baja hasta mostrarla.
      pista.addEventListener('focusin', function (e) {
        var t = e.target.closest('.caso');
        if (!t || !avance.scrollTrigger) return;
        var st = avance.scrollTrigger;
        var p = Math.min(1, Math.max(0, t.offsetLeft / Math.max(1, distancia())));
        window.scrollTo(0, st.start + (st.end - st.start) * p);
      });
      return function () { seccion.classList.remove('casos--horizontal'); };
    });

    mm.add('(max-width: 1023px)', function () {
      tarjetas.forEach(function (t) { t.querySelectorAll('[data-contar]').forEach(function (el) { contar(el, { start: 'top 85%' }); }); });
    });
  }

  function collage() {
    var c = doc.querySelector('.collage');
    if (!c) return;
    var velocidades = { panel: 10, hoy: -22, muro: 18, coleccion: -12 };
    var cursor = { panel: 10, hoy: 26, muro: 20, coleccion: 14 };
    var capas = c.querySelectorAll('.collage__capa');
    capas.forEach(function (capa) {
      var v = velocidades[capa.getAttribute('data-capa')] || 0;
      gsap.fromTo(capa, { yPercent: v }, { yPercent: -v, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    if (window.matchMedia('(pointer: fine)').matches) {
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        var dx = (e.clientX - r.left) / r.width - 0.5;
        var dy = (e.clientY - r.top) / r.height - 0.5;
        capas.forEach(function (capa) {
          var f = cursor[capa.getAttribute('data-capa')] || 0;
          gsap.to(capa.querySelector('.collage__marco'), { x: dx * f, y: dy * f, duration: 0.7, ease: 'power3.out', overwrite: 'auto' });
        });
      });
      c.addEventListener('pointerleave', function () {
        capas.forEach(function (capa) { gsap.to(capa.querySelector('.collage__marco'), { x: 0, y: 0, duration: 0.9, ease: 'power3.out', overwrite: 'auto' }); });
      });
    }
  }

  function titulares() {
    if (!window.SplitText) return;
    doc.querySelectorAll('.titular, .contacto__titulo').forEach(function (h) {
      // Sin máscara: el recorte cortaba las tildes de las mayúsculas (CÓMO, TAMBIÉN, ESCRÍBEME).
      var partido = window.SplitText.create(h, { type: 'lines', linesClass: 'linea-titular', aria: 'auto' });
      gsap.from(partido.lines, {
        yPercent: 60, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08,
        scrollTrigger: { trigger: h, start: 'top 88%', once: true }
      });
    });
  }
})();
