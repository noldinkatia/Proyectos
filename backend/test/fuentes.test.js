import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

// Fuentes en WOFF2 (solo latín) con el TTF original como alternativa.
const publicDir = new URL('../../public/', import.meta.url);

test('cada @font-face usa WOFF2 primero y el TTF original como alternativa', async () => {
  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  const caras = [...css.matchAll(/@font-face \{[^}]*\}/g)].map(m => m[0]);
  assert.equal(caras.length, 8);
  for (const cara of caras) {
    const [, nombre] = /url\("\/fonts\/([\w-]+)\.woff2"\) format\("woff2"\), url\("\/fonts\/\1\.ttf"\) format\("truetype"\)/.exec(cara) || [];
    assert.ok(nombre, cara);
    assert.match(cara, /font-display: swap/);
    const woff2 = (await stat(new URL(`fonts/${nombre}.woff2`, publicDir))).size;
    const ttf = (await stat(new URL(`fonts/${nombre}.ttf`, publicDir))).size;
    assert.ok(woff2 < 40 * 1024, `${nombre}.woff2 pesa ${woff2} bytes`);
    assert.ok(woff2 < ttf / 2, `${nombre}: el WOFF2 no es más liviano`);
    // Cabecera de WOFF2 ("wOF2").
    assert.equal((await readFile(new URL(`fonts/${nombre}.woff2`, publicDir))).subarray(0, 4).toString('latin1'), 'wOF2', nombre);
  }
});

test('el service worker precarga las fuentes WOFF2 (no los TTF)', async () => {
  const sw = await readFile(new URL('sw.js', publicDir), 'utf8');
  const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1];
  assert.equal((shell.match(/'\/fonts\/[\w-]+\.woff2'/g) || []).length, 8);
  assert.doesNotMatch(shell, /\.ttf'/);
});
