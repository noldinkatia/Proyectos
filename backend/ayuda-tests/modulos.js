// Grafo de módulos de cada página (la usan el test de modulepreload y el script que
// regenera la lista: node backend/ayuda-tests/modulos.js --escribir).
//
// Cada página precarga en el <head> todos los módulos que va a importar, para que el
// navegador los pida en paralelo en vez de ir descubriéndolos de a un nivel de
// import por vez (31 pedidos encadenados, ~1,7 s en 4G).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../../public/', import.meta.url);
export const PAGINAS = {
  'Rastreopy.html': ['/js/app.js', '/js/web.js'],
  'app/index.html': ['/js/app.js', '/app/app-movil.js']
};
export const INICIO = '<!-- modulepreload: generado por backend/ayuda-tests/modulos.js -->';
export const FIN = '<!-- /modulepreload -->';

// Todos los módulos que alcanza una página desde sus <script type="module">.
export async function modulosDe(entradas) {
  const vistos = new Set();
  const pendientes = [...entradas];
  while (pendientes.length) {
    const ruta = pendientes.pop();
    if (vistos.has(ruta)) continue;
    vistos.add(ruta);
    const codigo = await readFile(new URL(ruta.slice(1), publicDir), 'utf8');
    for (const [, destino] of codigo.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm)) {
      pendientes.push(destino.startsWith('/') ? destino : new URL(destino, `http://x${ruta}`).pathname);
    }
  }
  return [...vistos].sort();
}

export function bloquePrecarga(modulos, sangria = '  ') {
  return [INICIO, ...modulos.map(m => `<link rel="modulepreload" href="${m}">`), FIN].map(l => sangria + l).join('\n');
}

// --escribir: regenera el bloque en las dos páginas (conserva el fin de línea).
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--escribir')) {
  for (const [pagina, entradas] of Object.entries(PAGINAS)) {
    const archivo = new URL(pagina, publicDir);
    const original = await readFile(archivo, 'utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    let html = original.replace(/\r\n/g, '\n');
    const bloque = bloquePrecarga(await modulosDe(entradas));
    const inicio = html.indexOf(INICIO);
    if (inicio >= 0) {
      const desde = html.lastIndexOf('\n', inicio) + 1;
      const hasta = html.indexOf(FIN, inicio) + FIN.length;
      html = html.slice(0, desde) + bloque + html.slice(hasta);
    } else {
      html = html.replace('  <link rel="stylesheet" href="/styles.css">\n', `  <link rel="stylesheet" href="/styles.css">\n${bloque}\n`);
    }
    await writeFile(archivo, html.replace(/\n/g, eol));
    console.log(pagina, (await modulosDe(entradas)).length, 'módulos');
  }
}
