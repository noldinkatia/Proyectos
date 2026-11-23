import assert from 'node:assert/strict';
import test from 'node:test';

// "Mis casos" › "Indicar como localizado": solo abre una ventana que pide llamar a
// la administración (esa llamada verifica el dato). No cambia el estado ni hace
// ninguna petición. Interfaz con DOM falso, sin servidor ni base.
const publicDir = new URL('../../public/', import.meta.url);
const { renderMyCasesView, contenidoIndicarLocalizado, indicarLocalizado, PUEDE_INDICAR_LOCALIZADO } =
  await import(new URL('js/my-cases.js', publicDir));
const { CONTACTO_LOCALIZADO } = await import(new URL('js/config.js', publicDir));

const caso = (id, estado) => ({
  id, estado, nombreCompleto: `Persona ${id}`, edad: 30, ciudad: 'Asunción', fechaCreacion: '2026-11-01T12:00:00Z'
});
const ESTADOS = ['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO'];

// Tarjeta de cada caso (el HTML de renderMyCasesView, cortado por <article>).
function tarjetas(html) {
  return Object.fromEntries(html.split('<article class="my-case-card">').slice(1)
    .map(tarjeta => [tarjeta.match(/data-case-id="([^"]+)"/)[1], tarjeta]));
}

test('el botón aparece solo en casos en revisión, validados o en seguimiento', () => {
  assert.deepEqual(PUEDE_INDICAR_LOCALIZADO, ['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO']);
  const html = renderMyCasesView(ESTADOS.map(estado => caso(estado.toLowerCase(), estado)), []);
  const porCaso = tarjetas(html);
  for (const estado of ESTADOS) {
    const tarjeta = porCaso[estado.toLowerCase()];
    assert.ok(tarjeta, estado);
    const tiene = tarjeta.includes('>Indicar como localizado</button>');
    assert.equal(tiene, PUEDE_INDICAR_LOCALIZADO.includes(estado), `${estado}: ${tiene ? 'con' : 'sin'} botón`);
    if (tiene) {
      // Sin JavaScript inline (CSP): la acción va por data-on-click, con el id en data-case-id.
      assert.match(tarjeta, /data-case-id="[^"]+" data-on-click="indicarLocalizado\(this\.dataset\.caseId\)">Indicar como localizado/);
      assert.doesNotMatch(tarjeta, /\sonclick=/i);
    }
  }
});

test('el mensaje pide llamar; con número configurado, el enlace es tel:', () => {
  const sinNumero = contenidoIndicarLocalizado({ nombre: 'la administración de Rastreo PY', telefono: '' });
  assert.match(sinNumero, /Para confirmar que la persona fue localizada, comunicate por teléfono con la administración de Rastreo PY\./);
  assert.match(sinNumero, /Con esa llamada verificamos el dato y actualizamos el caso\./);
  assert.doesNotMatch(sinNumero, /href="tel:/, 'sin número no se inventa un enlace');

  const conNumero = contenidoIndicarLocalizado({ nombre: 'la administración', telefono: '+595 (21) 123-456' });
  assert.match(conNumero, /href="tel:\+59521123456">\+595 \(21\) 123-456<\/a>/);
  assert.match(contenidoIndicarLocalizado({ nombre: '<b>x</b>', telefono: '' }), /&lt;b&gt;x&lt;\/b&gt;/, 'escapado');

  // El valor de configuración existe y hoy no tiene número (pendiente de definir).
  assert.equal(typeof CONTACTO_LOCALIZADO.nombre, 'string');
  assert.equal(typeof CONTACTO_LOCALIZADO.telefono, 'string');
});

// <dialog> mínimo: guarda los listeners por selector y dispara "close" al cerrar.
function instalarDialogoFalso() {
  const peticiones = [];
  const abiertos = [];
  const anteriores = { document: globalThis.document, fetch: globalThis.fetch };
  const elemento = () => {
    const oyentes = {};
    return {
      oyentes,
      addEventListener: (tipo, fn) => { (oyentes[tipo] ||= []).push(fn); },
      setAttribute() {}, removeAttribute() {}, focus() {}
    };
  };
  globalThis.fetch = async (url, opciones = {}) => {
    peticiones.push({ url: String(url), metodo: opciones.method || 'GET' });
    return new Response('{}');
  };
  globalThis.document = {
    activeElement: null,
    body: { append: dialogo => abiertos.push(dialogo) },
    createElement: () => {
      const partes = new Map();
      const dialogo = {
        ...elemento(), className: '', innerHTML: '', abierto: false, eliminado: false,
        querySelector(selector) {
          // Solo existen los elementos que están en el HTML del cuadro.
          const clase = selector.replace(/^[a-z]+/, '').replace(/^\./, '');
          const existe = selector === 'form' ? this.innerHTML.includes('<form') : this.innerHTML.includes(clase);
          if (!existe) return null;
          if (!partes.has(selector)) partes.set(selector, elemento());
          return partes.get(selector);
        },
        showModal() { this.abierto = true; },
        close() { this.abierto = false; (this.oyentes.close || []).forEach(fn => fn()); },
        remove() { this.eliminado = true; },
        clic(selector) { (partes.get(selector)?.oyentes.click || []).forEach(fn => fn()); }
      };
      return dialogo;
    }
  };
  return { peticiones, abiertos, restaurar: () => Object.assign(globalThis, anteriores) };
}

test('abrir la ventana no hace ninguna petición; la X o "Entendido" la cierran', async () => {
  for (const cerrarCon of ['.dialogo-x', '.dialogo-cancelar']) {
    const dom = instalarDialogoFalso();
    try {
      const cerrada = indicarLocalizado('cas_1');
      const [dialogo] = dom.abiertos;
      assert.ok(dialogo?.abierto, 'se abre como modal (showModal: foco atrapado y Escape)');
      assert.match(dialogo.innerHTML, /Indicar como localizado/);
      assert.match(dialogo.innerHTML, /comunicate por teléfono con/);
      assert.match(dialogo.innerHTML, /class="btn-close dialogo-x" aria-label="Cerrar"/, 'X para cerrar');
      assert.equal((dialogo.innerHTML.match(/class="btn [^"]*"/g) || []).length, 1, 'un solo botón de cierre además de la X');
      assert.doesNotMatch(dialogo.innerHTML, /type="submit"|dialogo-confirmar/, 'nada que confirme o envíe');
      assert.doesNotMatch(dialogo.innerHTML, /\sonclick=/i);
      dialogo.clic(cerrarCon);
      await cerrada;
      assert.equal(dialogo.abierto, false, `${cerrarCon} cierra`);
      assert.equal(dialogo.eliminado, true);
      assert.deepEqual(dom.peticiones, [], 'ninguna petición (ni GET ni nada que modifique el caso)');
    } finally {
      dom.restaurar();
    }
  }
});
