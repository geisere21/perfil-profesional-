/**
 * Plantilla de la página. Solo estructura: los textos y las cifras salen de
 * datos/sitio.json. Las numeraciones de listas van por contadores CSS para que
 * la plantilla no introduzca dígitos que el verificador no pueda rastrear.
 */

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const waUrl = (numero, texto) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

/** <picture> con WebP por anchos y JPG de respaldo. */
function imagen(r, nombre, { alt, sizes = '100vw', clase = '', prioridad = false, decorativa = false } = {}) {
  const i = r.img(nombre);
  const srcset = i.webp.map(v => `${v.url} ${v.ancho}w`).join(', ');
  // El LCP es el nombre (texto), no la imagen: el póster carga de inmediato pero sin quitarle ancho de banda al CSS ni a Anton.
  const carga = prioridad ? 'loading="eager"' : 'loading="lazy"';
  const altAttr = decorativa ? 'alt=""' : `alt="${esc(alt)}"`;
  return `<picture${clase ? ` class="${clase}"` : ''}><source type="image/webp" srcset="${srcset}" sizes="${sizes}"><img src="${i.jpg.url}" width="${i.ancho}" height="${i.alto}" ${altAttr} ${carga} decoding="async"></picture>`;
}

/** Video silencioso: sin src hasta después de `load` (lo pone app.js). */
function video(r, v, { clase = '', decorativo = false, poster } = {}) {
  const info = r.vid(v.src);
  const posterUrl = poster || r.img(v.poster).webp[0].url;
  const etiqueta = decorativo ? 'aria-hidden="true"' : `aria-label="${esc(v.alt)}"`;
  return `<video class="${clase}" ${etiqueta} muted playsinline loop preload="none" width="${info.ancho}" height="${info.alto}" poster="${posterUrl}" data-src="${info.url}"></video>`;
}

/** Enlace de WhatsApp. Sin JavaScript es un enlace normal; con JavaScript abre el panel. */
function botonWa(s, { texto, clase, boton, q1 = null, mensaje }) {
  if (!s.persona.whatsapp) return '';
  const datos = `data-wa="${esc(boton)}"${q1 ? ` data-q1="${esc(q1)}"` : ''}`;
  return `<a class="${clase}" href="${waUrl(s.persona.whatsapp, mensaje || s.whatsapp_panel.mensaje_directo)}" ${datos} target="_blank" rel="noopener">${esc(texto)}</a>`;
}

function nombreConLetra(nombre) {
  // Envuelve la primera «i» del apellido: es el punto desde donde crece la máscara.
  const partes = nombre.split(' ');
  const ultima = partes.pop();
  const idx = ultima.toLowerCase().indexOf('i');
  const conLetra = idx < 0 ? esc(ultima)
    : `${esc(ultima.slice(0, idx))}<span class="portada__i">${esc(ultima[idx])}</span>${esc(ultima.slice(idx + 1))}`;
  return `<span class="portada__linea">${esc(partes.join(' '))}</span> <span class="portada__linea">${conLetra}</span>`;
}

function cifra(c, frente) {
  const final = c.valor;
  const numero = Number(String(final).replace(/\./g, ''));
  const contar = Number.isInteger(numero) && numero > 0 ? ` data-contar="${numero}"` : '';
  return `<li class="cifra">
          <span class="cifra__numero">${c.prefijo ? `<span class="cifra__prefijo">${esc(c.prefijo)}</span> ` : ''}<span class="cifra__valor"><span class="cifra__vivo" aria-hidden="true"${contar}>${esc(final)}</span><span class="sr-only">${esc(final)}</span></span>${c.denominador ? ` <span class="cifra__de">de ${esc(c.denominador)}</span>` : ''}${c.unidad ? ` <span class="cifra__unidad">${esc(c.unidad)}</span>` : ''}</span>
          <span class="cifra__etiqueta">${esc(c.etiqueta)}</span>
        </li>`;
}

function caso(s, r, c) {
  const fisico = c.frente === 'fisico';
  const chip = fisico ? s.portada.chip_fisico : s.portada.chip_digital;
  const medios = c.media.map((m, i) => {
    if (m.tipo === 'video') return `<figure class="caso__medio caso__medio--video">${video(r, m, { clase: 'caso__video' })}</figure>`;
    return `<figure class="caso__medio${m.foto ? ' foto' : ''}">${imagen(r, m.src, { alt: m.alt, sizes: '(min-width: 1024px) 34vw, 92vw' })}</figure>`;
  }).join('\n        ');
  return `<article class="caso caso--${fisico ? 'fisico' : 'digital'}" id="${esc(c.slug)}" aria-labelledby="${esc(c.slug)}-nombre">
      <div class="caso__texto">
        <p class="caso__cabeza"><span class="chip chip--${fisico ? 'fisico' : 'digital'}">${esc(chip)}</span>${c.cliente ? ` <span class="caso__cliente">${esc(c.cliente)}</span>` : ''}</p>
        <h3 class="caso__nombre" id="${esc(c.slug)}-nombre">${esc(c.nombre)}</h3>
        <p class="caso__que-era">${esc(c.que_era)}</p>
        <p class="caso__que-hice"><strong>${esc(s.etiqueta_que_hice)}.</strong> ${esc(c.que_hice)}</p>
        <ul class="cifras">
        ${c.cifras.map(x => cifra(x, c.frente)).join('\n        ')}
        </ul>${c.nota_cifras ? `
        <p class="caso__nota">${esc(c.nota_cifras)}</p>` : ''}${c.cita ? `
        <blockquote class="cita cita--rojo"><p>«${esc(c.cita)}»</p></blockquote>` : ''}${c.lo_que_no_funciono ? `
        <div class="caso__fallo"><p class="caso__fallo-rotulo">${esc(s.etiqueta_no_funciono)}</p><p>${esc(c.lo_que_no_funciono)}</p></div>` : ''}
      </div>
      <div class="caso__medios caso__medios--${c.media.length}">
        ${medios}
      </div>
    </article>`;
}

export function pagina(s, r) {
  const p = s.persona;
  const wp = s.whatsapp_panel;
  const casosPublicados = s.casos.filter(c => c.publicado);
  const aptitudesCinta = s.aptitudes.map(a => `<span class="cinta__item">${esc(a.nombre)}</span> <span class="cinta__sep">✱</span>`).join(' ');
  const destacado = s.digital.titulo_destacado;
  const tituloDigital = destacado && s.digital.titulo.endsWith(destacado)
    ? `${esc(s.digital.titulo.slice(0, -destacado.length))}<span class="lima">${esc(destacado)}</span>`
    : esc(s.digital.titulo);
  const capas = s.digital.capas.map(c => `<div class="collage__capa collage__capa--${esc(c.rol)}" data-capa="${esc(c.rol)}"><div class="collage__marco">${imagen(r, c.src, { alt: c.alt, sizes: '(min-width: 1024px) 50vw, 80vw' })}</div></div>`).join('\n        ');

  const privacidad = r.privacidad;

  return `<!doctype html>
<html lang="${s.sitio.idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.sitio.titulo)}</title>
<meta name="description" content="${esc(p.descripcion)}">
<link rel="canonical" href="${s.sitio.url}">
<link rel="alternate" type="text/markdown" href="/index.md">
<meta name="theme-color" content="#0A0A0A">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="profile">
<meta property="og:locale" content="es_VE">
<meta property="og:site_name" content="${esc(p.nombre)}">
<meta property="og:url" content="${s.sitio.url}">
<meta property="og:title" content="${esc(s.sitio.titulo)}">
<meta property="og:description" content="${esc(p.descripcion)}">
<meta property="og:image" content="${r.og.url}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(r.og.alt)}">
<meta property="profile:first_name" content="${esc(p.nombre.split(' ')[0])}">
<meta property="profile:last_name" content="${esc(p.nombre.split(' ').slice(1).join(' '))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(s.sitio.titulo)}">
<meta name="twitter:description" content="${esc(p.descripcion)}">
<meta name="twitter:image" content="${r.og.url}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/icono-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="${r.fuentes.anton}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${r.css}">
<script type="application/ld+json">${r.jsonld}</script>
<script type="application/json" id="config-sitio">${r.config}</script>
<script src="${r.js.gsap}" defer></script>
<script src="${r.js.scrollTrigger}" defer></script>
<script src="${r.js.splitText}" defer></script>
<script src="${r.js.app}" defer></script>
</head>
<body>
<a class="salto" href="#contenido" data-md="omitir">Saltar al contenido</a>

<header class="nav" data-md="omitir">
  <a class="nav__logo" href="#inicio" aria-label="${esc(p.nombre)}, inicio">${esc(p.nombre)}</a>
  <nav class="nav__anclas" aria-label="Secciones">
    ${s.nav.anclas.map(a => `<a href="${esc(a.destino)}">${esc(a.texto)}</a>`).join('\n    ')}
  </nav>
  ${botonWa(s, { texto: s.nav.boton_whatsapp, clase: 'boton boton--principal boton--chico', boton: 'nav' })}
</header>

<main id="contenido">

<section class="portada" id="inicio" aria-labelledby="nombre">
  <div class="portada__escena">
    <div class="portada__medio" aria-hidden="true">
      ${imagen(r, s.portada.video.poster, { decorativa: true, sizes: '(max-width: 819px) 50vw, 100vw', clase: 'portada__poster', prioridad: true })}
      ${video(r, s.portada.video, { clase: 'portada__video', decorativo: true, poster: r.img(s.portada.video.poster).webp[0].url })}
      <div class="portada__velo"></div>
    </div>
    <div class="portada__mascara">
      <h1 class="portada__nombre" id="nombre">${nombreConLetra(p.nombre)}</h1>
    </div>
    <div class="portada__texto">
      <div class="portada__lectura">
        <p class="portada__frase">${esc(p.frase_identidad)}</p>
        <p class="portada__respuesta">${esc(p.descripcion)}</p>
      </div>
      <div class="portada__lado">
        <div class="portada__acciones">
          ${botonWa(s, { texto: s.portada.boton_principal, clase: 'boton boton--principal', boton: 'portada' })}
          <a class="boton boton--secundario" href="#casos" data-evento="ver_casos">${esc(s.portada.boton_secundario)}</a>
        </div>
        <p class="portada__chips"><span class="chip chip--fisico">${esc(s.portada.chip_fisico)}</span> <span class="chip chip--digital">${esc(s.portada.chip_digital)}</span></p>
      </div>
    </div>
  </div>
</section>

<div class="cinta" aria-hidden="true" data-md="omitir">
  <div class="cinta__pista">
    <p class="cinta__grupo">${aptitudesCinta}</p>
    <p class="cinta__grupo" data-duplicado>${aptitudesCinta}</p>
  </div>
</div>

<section class="seccion" id="que-hago" aria-labelledby="que-hago-titulo">
  <div class="contenedor">
    <h2 class="titular" id="que-hago-titulo">${esc(s.aptitudes_titulo)}</h2>
    <p class="seccion__intro">${esc(s.aptitudes_intro)}</p>
    <ol class="aptitudes">
      ${s.aptitudes.map(a => `<li class="aptitud"><h3 class="aptitud__nombre">${esc(a.nombre)}</h3> <p class="aptitud__linea">${esc(a.linea)}</p></li>`).join('\n      ')}
    </ol>
  </div>
</section>

<section class="seccion seccion--alterna casos" id="casos" aria-labelledby="casos-titulo">
  <div class="casos__escenario">
    <div class="casos__cabeza contenedor">
      <h2 class="titular" id="casos-titulo">${esc(s.casos_titulo)}</h2>
      <p class="seccion__intro">${esc(s.casos_intro)}</p>
    </div>
    <div class="casos__ventana">
      <div class="casos__pista">
      ${casosPublicados.map(c => caso(s, r, c)).join('\n      ')}
      </div>
    </div>
  </div>
</section>

<section class="seccion digital" id="digital" aria-labelledby="digital-titulo">
  <div class="contenedor">
    <h2 class="titular" id="digital-titulo">${tituloDigital}</h2>
    <p class="seccion__intro">${esc(s.digital.texto)}</p>
  </div>
  <div class="collage">
        ${capas}
  </div>
</section>

<section class="seccion seccion--alterna" id="como-trabajo" aria-labelledby="como-trabajo-titulo">
  <div class="contenedor como">
    <figure class="como__foto foto">${imagen(r, s.como_trabajo.foto.src, { alt: s.como_trabajo.foto.alt, sizes: '(min-width: 1024px) 34vw, 92vw', foto: true })}</figure>
    <div class="como__texto">
      <h2 class="titular" id="como-trabajo-titulo">${esc(s.como_trabajo.titulo)}</h2>
      <ol class="reglas">
        ${s.como_trabajo.reglas.map(x => `<li class="regla"><h3 class="regla__texto">${esc(x.regla)}</h3> <p class="regla__apoyo">${esc(x.apoyo)}</p></li>`).join('\n        ')}
      </ol>
    </div>
  </div>
</section>

<section class="seccion" id="servicios" aria-labelledby="servicios-titulo">
  <div class="contenedor">
    <h2 class="titular" id="servicios-titulo">${esc(s.servicios_titulo)}</h2>
    <p class="seccion__intro">${esc(s.servicios_intro)}</p>
    <table class="servicios">
      <thead><tr><th scope="col">${esc(s.servicios_encabezados.servicio)}</th><th scope="col">${esc(s.servicios_encabezados.entrega)}</th></tr></thead>
      <tbody>
      ${s.servicios.map(x => `<tr><td class="servicios__nombre">${p.whatsapp
        ? botonWa(s, { texto: x.nombre, clase: 'servicios__enlace', boton: 'servicio-' + x.slug, q1: x.pregunta1, mensaje: wp.mensaje_servicio + x.nombre_corto })
        : esc(x.nombre)}</td><td class="servicios__entrega">${esc(x.entrega)}</td></tr>`).join('\n      ')}
      </tbody>
    </table>
    <p class="servicios__nota">${esc(s.servicios_nota)}</p>
  </div>
</section>

<section class="seccion seccion--alterna fuera" id="fuera" aria-labelledby="fuera-titulo">
  <div class="contenedor fuera__rejilla">
    <div class="fuera__texto">
      <h2 class="titular" id="fuera-titulo">${esc(s.fuera.titulo)}</h2>
      <blockquote class="cita cita--rojo cita--grande"><p>«${esc(s.fuera.cita)}»</p></blockquote>
      <p>${esc(s.fuera.texto)}</p>
      <p class="fuera__hyrox">${esc(s.fuera.hyrox)}</p>
      ${p.sameAs.find(u => u.includes('instagram.com')) ? `<p><a class="enlace" href="${esc(p.sameAs.find(u => u.includes('instagram.com')))}" target="_blank" rel="noopener me">${esc(s.fuera.enlace_instagram)}</a></p>` : ''}
    </div>
    <figure class="fuera__video">${video(r, s.fuera.video, { clase: 'fuera__clip' })}</figure>
    <figure class="fuera__foto foto">${imagen(r, s.fuera.foto.src, { alt: s.fuera.foto.alt, sizes: '(min-width: 1024px) 26vw, 46vw' })}</figure>
  </div>
</section>

<section class="seccion" id="preguntas" aria-labelledby="preguntas-titulo">
  <div class="contenedor">
    <h2 class="titular" id="preguntas-titulo">${esc(s.faq_titulo)}</h2>
    <div class="faq">
      ${s.faq.map(f => {
        let resp = esc(f.respuesta);
        if (f.enlace) resp = resp.replace(esc(f.enlace.texto), `<a class="enlace" href="${esc(f.enlace.destino)}">${esc(f.enlace.texto)}</a>`);
        return `<div class="faq__item"><h3 class="faq__pregunta">${esc(f.pregunta)}</h3> <p class="faq__respuesta">${resp}</p></div>`;
      }).join('\n      ')}
    </div>
  </div>
</section>

<section class="seccion contacto" id="contacto" aria-labelledby="contacto-titulo">
  <div class="contenedor">
    <h2 class="contacto__titulo" id="contacto-titulo">${esc(s.contacto.titulo)}</h2>
    <p class="seccion__intro">${esc(s.contacto.texto)}</p>
    <div class="contacto__accion">${botonWa(s, { texto: s.portada.boton_principal, clase: 'boton boton--principal boton--grande', boton: 'contacto' })}</div>
    <ul class="contacto__lista">
      ${p.whatsapp ? `<li><span class="contacto__rotulo">${esc(s.contacto.etiqueta_whatsapp)}</span> ${botonWa(s, { texto: r.whatsappVisible, clase: 'contacto__enlace', boton: 'contacto' })}</li>` : ''}
      <li><span class="contacto__rotulo">${esc(s.contacto.etiqueta_correo)}</span> <a class="contacto__enlace" href="mailto:${esc(p.email)}" data-evento="correo">${esc(p.email)}</a></li>
      ${p.sameAs.filter(u => u.includes('instagram.com')).map(u => `<li><span class="contacto__rotulo">${esc(s.contacto.etiqueta_instagram)}</span> <a class="contacto__enlace" href="${esc(u)}" target="_blank" rel="noopener me">${esc(p.instagram_usuario)}</a></li>`).join('')}
      ${p.sameAs.filter(u => u.includes('linkedin.com')).map(u => `<li><span class="contacto__rotulo">${esc(s.contacto.etiqueta_linkedin)}</span> <a class="contacto__enlace" href="${esc(u)}" target="_blank" rel="noopener me">${esc(p.linkedin_texto)}</a></li>`).join('')}
    </ul>
  </div>
</section>

</main>

<footer class="pie">
  <div class="contenedor pie__rejilla">
    <p class="pie__lugar">${esc(p.ciudad)}, ${esc(p.pais)} · ${r.anio}</p>
    <div class="pie__privacidad" id="privacidad">
      <h2 class="pie__titulo">${esc(s.contacto.privacidad_titulo)}</h2>
      <p>${esc(privacidad)}</p>
    </div>
  </div>
</footer>

${p.whatsapp ? `<div class="barra-wa" data-md="omitir">${botonWa(s, { texto: s.portada.boton_principal, clase: 'boton boton--principal', boton: 'barra' })}</div>

<dialog class="panel-wa" id="panel-wa" aria-labelledby="panel-wa-titulo" data-md="omitir">
  <div class="panel-wa__caja">
    <button type="button" class="panel-wa__cerrar" data-cerrar aria-label="${esc(wp.cerrar)}">×</button>
    <h2 class="panel-wa__titulo" id="panel-wa-titulo">${esc(wp.titulo)}</h2>
    <p class="panel-wa__intro">${esc(wp.intro)}</p>
    <fieldset class="panel-wa__pregunta">
      <legend>${esc(wp.pregunta1)}</legend>
      ${wp.opciones1.map(o => `<label class="opcion"><input type="radio" name="q1" value="${esc(o.valor)}"><span>${esc(o.texto)}</span></label>`).join('\n      ')}
    </fieldset>
    <fieldset class="panel-wa__pregunta">
      <legend>${esc(wp.pregunta2)}</legend>
      ${wp.opciones2.map(o => `<label class="opcion"><input type="radio" name="q2" value="${esc(o.valor)}"><span>${esc(o.texto)}</span></label>`).join('\n      ')}
    </fieldset>
    <a class="boton boton--principal panel-wa__abrir" id="panel-wa-abrir" href="${waUrl(p.whatsapp, wp.mensaje_directo)}" aria-disabled="true" target="_blank" rel="noopener">${esc(wp.boton)}</a>
    <a class="panel-wa__directo" id="panel-wa-directo" href="${waUrl(p.whatsapp, wp.mensaje_directo)}" target="_blank" rel="noopener">${esc(wp.directo)}</a>
  </div>
</dialog>` : ''}
</body>
</html>
`;
}

export function pagina404(s, r) {
  return `<!doctype html>
<html lang="${s.sitio.idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Página no encontrada · ${esc(s.persona.nombre)}</title>
<meta name="description" content="Esta dirección no existe en el sitio de ${esc(s.persona.nombre)}. La página principal tiene sus casos, servicios y contacto.">
<meta name="robots" content="noindex">
<meta property="og:title" content="${esc(s.sitio.titulo)}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="stylesheet" href="${r.css}">
</head>
<body class="pagina-404">
<main class="seccion contenedor">
  <h1 class="titular">Esta página no existe</h1>
  <p class="seccion__intro">${esc(s.persona.descripcion)}</p>
  <p><a class="boton boton--principal" href="/">Ir a la página principal</a></p>
</main>
</body>
</html>
`;
}
