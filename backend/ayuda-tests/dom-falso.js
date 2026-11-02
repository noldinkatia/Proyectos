// DOM mínimo para los tests de la interfaz (no tiene tests propios): cada id es
// un elemento que se crea al pedirlo, con value, checked, classList, innerHTML...
export function elementoFalso(id) {
  const clases = new Set();
  return {
    id, value: '', checked: false, textContent: '', innerText: '', innerHTML: '', disabled: false, required: false,
    src: '', dataset: {},
    classList: {
      add: c => clases.add(c),
      remove: c => clases.delete(c),
      contains: c => clases.has(c),
      toggle: (c, forzar = !clases.has(c)) => (forzar ? clases.add(c) : clases.delete(c), forzar)
    },
    scrollIntoView() {}, focus() {}, reset() {}, replaceChildren() {},
    querySelector: () => elementoFalso(`${id} hijo`),
    querySelectorAll: () => []
  };
}

// Instala document, window, localStorage y sessionStorage falsos. valores: id → value
// inicial; ocultos: ids que empiezan con la clase "hidden"; selector(consulta): lo que
// devuelve document.querySelectorAll. restaurar() deja todo como estaba.
export function instalarDom(valores = {}, ocultos = [], selector = () => []) {
  const elementos = new Map();
  const obtener = id => {
    if (!elementos.has(id)) elementos.set(id, elementoFalso(id));
    return elementos.get(id);
  };
  for (const [id, valor] of Object.entries(valores)) obtener(id).value = valor;
  for (const id of ocultos) obtener(id).classList.add('hidden');
  const anteriores = {
    document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch,
    localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage
  };
  globalThis.document = { getElementById: obtener, querySelectorAll: selector, createElement: () => elementoFalso('nuevo') };
  globalThis.window = { backendCaseData: { casos: [], pistas: [] } };
  const almacen = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.localStorage = almacen;
  globalThis.sessionStorage = { ...almacen, getItem: () => 'tok' };
  return {
    obtener,
    restaurar: () => Object.assign(globalThis, anteriores)
  };
}
