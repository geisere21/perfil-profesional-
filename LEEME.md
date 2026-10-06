# Landing de Geiser Elligon · v2

https://geiser-elligon.pages.dev/ · Cloudflare Pages, cuenta de Geiser.

Una página generada desde `datos/sitio.json`. Ningún texto ni cifra se escribe en la plantilla: se cambia el dato y se vuelve a construir. El spec está en `../04-SPEC-LANDING.md`.

## Comandos

| Para | Comando |
|---|---|
| Traer de `../assets` los medios que usa `sitio.json`, sin metadatos | `npm run medios` |
| Construir `dist/` | `npm run construir` |
| Verificador AEO (32 criterios, falla con código de error) | `npm run verificar` |
| Ver en local, también desde el teléfono en la misma red | `npm run servir` → puerto 8098 |
| Pruebas en Chrome real (los 5 casos de verify-after-changes) | `npm run pruebas` (con el servidor local corriendo) |
| Publicar: verifica, prueba, despliega y comprueba en vivo | `npm run desplegar` |
| Leer las métricas con su denominador | `npm run metricas` (o `node scripts/metricas.mjs 7`) |

## Decisiones que no se ven en el código

- **Los videos viven en `/video/` y los sirve `functions/video`.** Cloudflare Pages responde 200 completo aunque el navegador pida un rango, y Safari en iPhone no reproduce video sin 206. Comprobado el 6 oct 2026.
- **La portada usa `position: sticky`, no el fijado de GSAP.** El fijado envolvía el nombre en un contenedor nuevo, Chrome lo repintaba como elemento nuevo y el LCP pasaba de 2,0 a 3,8 s en 4G lento.
- **Los titulares animados no llevan máscara.** El recorte cortaba las tildes de las mayúsculas (CÓMO, TAMBIÉN, ESCRÍBEME).
- **La medición es propia** (`functions/api/evento.js` → D1 `geiser-elligon-medicion`): sin cookies, sin IP, sin agente de usuario. Los eventos válidos salen de `sitio.json`, la misma fuente que escribe la nota de privacidad. Poner `conexiones.seguimiento_clics` en `null` la apaga y cambia la nota sola.
- **La raíz del repo (`index.html`, `404.html`, `_config.yml`) es la redirección** que GitHub Pages publica en la URL vieja. El sitio real es `dist/`.
- **`medios/` es una copia sin metadatos** de lo que se usa de `../assets` (la lista cerrada). Las fotos originales traían EXIF.
