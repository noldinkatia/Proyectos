import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import test from 'node:test';

// Dos páginas comparten los módulos de public/js/: la web (Rastreopy.html) y la app
// (app/index.html). Esos módulos buscan contenedores fijos por id (mainContent,
// drawer, modales, franja offline...), así que las dos páginas tienen que tenerlos.
// Este test detecta si una página pierde un id que un módulo usa.
const publicDir = new URL('../../public/', import.meta.url);
const read = path => readFile(new URL(path, publicDir), 'utf8');

// Del panel de administración: solo en la web. La app no duplica el panel
// (router.js lleva al admin a /#/panel), así que no los tiene.
const ADMIN_PANEL_ONLY = ['reviewCaseDetails', 'reviewChecklistForm', 'reviewChecklistModal',
  'reviewDenuncia', 'simTimeModal', 'simulateFollowupButton'];

// ids que un archivo busca con getElementById('x') o querySelector('#x').
function idsBuscados(source) {
  return [
    ...[...source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
    ...[...source.matchAll(/querySelector(?:All)?\(\s*['"`]#([A-Za-z][\w-]*)/g)].map(m => m[1])
  ];
}

// ids que un archivo crea en sus plantillas (id="x" sin ${...}).
function idsCreados(source) {
  return [...source.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]);
}

async function jsDe(dir) {
  const files = (await readdir(new URL(dir, publicDir))).filter(file => file.endsWith('.js'));
  return Promise.all(files.map(async file => [`${dir}${file}`, await read(`${dir}${file}`)]));
}

// Los ids que una página tiene que traer en su HTML para un conjunto de módulos.
function requeridos(modulos, plantillas) {
  const creados = new Set(plantillas.flatMap(([, source]) => idsCreados(source)));
  return [...new Set(modulos.flatMap(([, source]) => idsBuscados(source)))].filter(id => !creados.has(id)).sort();
}

test('web y app tienen los contenedores e ids que esperan los módulos', async () => {
  const js = await jsDe('js/');
  const app = await jsDe('app/');
  const compartidos = js.filter(([file]) => file !== 'js/web.js');
  const web = { html: await read('Rastreopy.html'), propios: js.filter(([file]) => file === 'js/web.js') };
  const movil = { html: await read('app/index.html'), propios: app };

  const comunes = requeridos(compartidos, js);
  assert.ok(comunes.length > 20, `se esperaban más ids compartidos, hay ${comunes.length}`);
  for (const id of ADMIN_PANEL_ONLY) assert.ok(comunes.includes(id), `${id} ya no lo usa ningún módulo: sacarlo de ADMIN_PANEL_ONLY`);

  for (const [pagina, { html, propios }, excepto] of [
    ['Rastreopy.html', web, []],
    ['app/index.html', movil, ADMIN_PANEL_ONLY]
  ]) {
    const presentes = idsCreados(html);
    const duplicados = presentes.filter((id, index) => presentes.indexOf(id) !== index);
    assert.deepEqual(duplicados, [], `${pagina}: ids repetidos`);
    const necesarios = [...comunes.filter(id => !excepto.includes(id)), ...requeridos(propios, [...js, ...app])];
    const faltan = necesarios.filter(id => !presentes.includes(id));
    assert.deepEqual(faltan, [], `${pagina}: faltan ids que usan los módulos`);
  }
  const appHtml = idsCreados(movil.html);
  assert.deepEqual(ADMIN_PANEL_ONLY.filter(id => appHtml.includes(id)), [], 'la app no duplica el panel admin');
});

test('solo la app es instalable: manifest fijo en /app/ y ninguno en la web', async () => {
  const web = await read('Rastreopy.html');
  const app = await read('app/index.html');
  assert.doesNotMatch(web, /rel="manifest"/);
  assert.match(app, /<link rel="manifest" href="\/app\/manifest\.webmanifest">/);
  assert.match(app, /viewport-fit=cover/);
  assert.match(app, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(app, /name="apple-mobile-web-app-title"/);
  assert.match(app, /rel="apple-touch-icon" href="\/icons\/rastreopy-192\.png"/);
  assert.match(app, /name="theme-color"/);
  const manifest = JSON.parse(await read('app/manifest.webmanifest'));
  assert.equal(manifest.id, '/app/');
  assert.equal(manifest.start_url, '/app/');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.display, 'standalone');
  for (const size of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.purpose === purpose && icon.type === 'image/png'), `${size} ${purpose}`);
    }
  }
});

test('web en computadora: botón "Descargar app" en el encabezado que lleva a /app/ con la ruta', async () => {
  const web = await read('Rastreopy.html');
  const header = web.match(/<header id="topHeader"[\s\S]*?<\/header>/)[0];
  assert.match(header, /<a id="headerAppLink" class="header-app-link hidden" href="\/app\/">Descargar app<\/a>/);
  const js = await read('js/web.js');
  // Fuera de los celulares se muestra el botón; en celulares sigue el aviso de abajo.
  assert.match(js, /if \(!esCelular\(\)\) \{\s*mostrarEnlaceApp\('headerAppLink'\);\s*document\.getElementById\('headerAppLink'\)\?\.classList\.remove\('hidden'\);/);
  assert.match(js, /\} else if \(!avisoCerrado\(\)\) \{\s*mostrarEnlaceApp\('openAppLink'\);/);
  // Conserva #/caso/..., #/estadisticas y se actualiza al navegar.
  assert.match(js, /enlace\.href = `\/app\/\$\{location\.hash\}`/);
  assert.match(js, /addEventListener\('hashchange', \(\) => actualizarEnlace\(id\)\)/);
  const css = await read('styles.css');
  const regla = css.slice(css.indexOf('#topHeader .header-app-link {'), css.indexOf('}', css.indexOf('#topHeader .header-app-link {')));
  assert.match(regla, /cursor:\s*pointer/);
  assert.match(regla, /border:\s*1px solid/, 'se ve como botón');
});

test('app en computadora: "Instalar app" solo con beforeinstallprompt; si no, aviso para el celular', async () => {
  const app = await read('app/index.html');
  assert.match(app, /<p id="installDesktopHint" class="drawer-hint hidden">Para instalarla, abrí esta dirección desde tu celular\.<\/p>/);
  assert.doesNotMatch(app, /<canvas|qrcode/i, 'sin código QR');
  const pwa = await read('app/pwa.js');
  assert.match(pwa, /matchMedia\('\(min-width: 781px\) and \(pointer: fine\)'\)/);
  assert.match(pwa, /getElementById\('installDesktopHint'\)\?\.classList\.toggle\('hidden', puedeInstalar \|\| yaInstalada\(\) \|\| !esComputadora\(\)\)/);
  // La bienvenida sigue siendo solo para celulares.
  assert.match(pwa, /if \(esCelular\(\) && !yaInstalada\(\) && !bienvenidaYaVista\(\)\) mostrarBienvenida\(true\)/);
});

test('barra lateral en celulares: ancho adaptable, scroll interno y nada encima', async () => {
  const css = await read('styles.css');
  const regla = selector => {
    const inicio = css.indexOf(`${selector} {`);
    assert.ok(inicio >= 0, `falta la regla ${selector}`);
    return css.slice(inicio, css.indexOf('}', inicio));
  };
  // Hasta 560 px: entre 240 y 300 px, siempre deja una franja de la página (tocarla cierra).
  const celulares = css.slice(css.indexOf('@media (max-width: 560px) {'));
  assert.match(celulares.slice(0, celulares.indexOf('\n}')), /\.drawer \{ width: clamp\(240px, 78vw, 300px\); \}/);
  const drawer = regla('.drawer');
  assert.match(drawer, /overflow-y:\s*auto/, 'scroll interno en pantallas bajas');
  assert.match(drawer, /overscroll-behavior:\s*contain/);
  const z = selector => Number(/z-index:\s*(\d+)/.exec(regla(selector))[1]);
  assert.ok(z('.open-app-notice') < z('.drawer-overlay'), 'el aviso "Abrir la app" no tapa el menú abierto');
  // El fondo cierra el menú al tocarlo, en las dos páginas.
  for (const pagina of ['Rastreopy.html', 'app/index.html']) {
    assert.match(await read(pagina), /<div id="drawerOverlay" data-on-click="toggleDrawer\(false\)"/, pagina);
  }
});

test('encabezado de la app: nombre centrado con la "R" y acciones en la misma fila en celulares', async () => {
  const app = await read('app/index.html');
  // Sin subtítulo en la app: la grilla de .brand-title tiene que ser de una fila.
  assert.doesNotMatch(app, /brand-subtitle/);
  const css = await read('app/app.css');
  assert.match(css, /body\.app-movil \.brand-title \{ grid-template-rows: auto; \}/);
  assert.match(css, /body\.app-movil \.brand-title::before \{ grid-row: 1; \}/);
  // La web manda las acciones a una segunda fila hasta 560 px; la app lo anula.
  const web = await read('styles.css');
  assert.match(web, /@media \(max-width: 560px\) \{[\s\S]*?#topHeader > div:last-child \{ flex: 1 0 100%;/);
  const celulares = css.slice(css.indexOf('@media (max-width: 560px) {'));
  const bloque = celulares.slice(0, celulares.indexOf('\n}'));
  assert.match(bloque, /body\.app-movil #topHeader \{ flex-wrap: nowrap; \}/);
  assert.match(bloque, /body\.app-movil #topHeader > div:last-child \{ flex: 0 1 auto; min-width: 0; flex-wrap: nowrap; \}/);
  assert.match(bloque, /body\.app-movil #headerProfileName \{ max-width: [\d.]+rem; \}/, 'el nombre se recorta antes de empujar la fila');
});

test('tema claro/oscuro: un solo botón, en el menú lateral, en la web y en la app', async () => {
  for (const pagina of ['Rastreopy.html', 'app/index.html']) {
    const html = await read(pagina);
    const botones = html.match(/data-on-click="toggleTheme\(\)"/g) || [];
    assert.equal(botones.length, 1, `${pagina}: un solo botón de tema`);
    const drawer = html.match(/<aside id="drawer"[\s\S]*?<\/aside>/)[0];
    assert.match(drawer, /<div class="drawer-account">[\s\S]*<button id="themeToggle" type="button" data-on-click="toggleTheme\(\)" class="btn btn-outline"/, `${pagina}: en "Cuenta y avisos"`);
    // Sin data-role-nav: se ve con y sin sesión.
    assert.doesNotMatch(drawer.match(/<button id="themeToggle"[^>]*>/)[0], /data-role-nav|hidden/);
    assert.doesNotMatch(html.match(/<header id="topHeader"[\s\S]*?<\/header>/)[0], /themeToggle/, `${pagina}: no en el encabezado`);
  }
  // Ya no hay botón flotante ni los rellenos que le dejaban lugar.
  for (const archivo of ['styles.css', 'app/app.css', 'js/router.js', 'js/ui.js']) {
    assert.doesNotMatch(await read(archivo), /publicThemeToggle|public-theme-toggle/, archivo);
  }
});

test('"Bases y condiciones": en el pie de la web y en el menú lateral de la web y de la app', async () => {
  const web = await read('Rastreopy.html');
  const pie = web.match(/<footer class="app-footer institutional-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(pie, /<a class="footer-link" href="#\/bases">Bases y condiciones<\/a>/);
  for (const pagina of ['Rastreopy.html', 'app/index.html']) {
    const nav = (await read(pagina)).match(/<nav class="drawer-navigation"[\s\S]*?<\/nav>/)[0];
    // Sin data-role-nav: con y sin sesión. data-nav-view lo marca como sección actual.
    assert.match(nav, /<button type="button" data-nav-view="legal" data-on-click="drawerNavigate\('legal'\)" class="drawer-item">Bases y condiciones<\/button>/, pagina);
  }
});

test('el APP_SHELL del service worker cubre la web, la app y sus módulos', async () => {
  const sw = await read('sw.js');
  const shell = [...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  // Rutas de página → archivo que sirve Express.
  const archivo = entry => ({ '/': 'Rastreopy.html', '/app/': 'app/index.html' })[entry] || entry.slice(1);
  for (const entry of shell) {
    assert.ok((await stat(new URL(archivo(entry), publicDir))).isFile(), `${entry} no existe en public/`);
  }
  const esperados = ['/', '/offline.html', '/app/'];
  for (const dir of ['js/', 'app/', 'icons/']) {
    for (const file of await readdir(new URL(dir, publicDir))) {
      if (file !== 'index.html') esperados.push(`/${dir}${file}`);
    }
  }
  const faltan = esperados.filter(entry => !shell.includes(entry) && !(entry === '/offline.html' && /OFFLINE_PAGE,/.test(sw)));
  assert.deepEqual(faltan, [], 'archivos de public/ que faltan en APP_SHELL (y subir la versión del caché)');
});
