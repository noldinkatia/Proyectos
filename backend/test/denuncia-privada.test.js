import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { toAdminCase, toOwnerCase, toPublicCase } from '../case-shared.js';
import { createApp } from '../server.js';

// El número de denuncia (casos.numero_denuncia) solo lo ven quien reportó el caso
// y la administración. Ni visitantes sin sesión ni otros ciudadanos, en ninguna
// respuesta ni en la ficha pública. Corre sin PostgreSQL (base simulada).
const secret = 'test-secret-with-at-least-thirty-two-characters';
const NUMERO = 'DEN-PRIVADA-777';
const DUENO = 10;
const OTRO = 42;
const ADMIN = 11;

const fila = (extra = {}) => ({
  id: 'cas_den', nombre_completo: 'Persona Pública', edad: 30, sexo: 'Femenino', ciudad: 'Asunción',
  departamento: 'Capital', barrio: 'Centro', descripcion_fisica: 'Alta', vestimenta: 'Remera',
  senas_particulares: 'Lunar', fecha_hora_desaparicion: new Date('2026-11-01T12:00:00Z'),
  latitud: -25.3, longitud: -57.6, direccion: 'Asunción', estado: 'VALIDADO',
  creado_en: new Date('2026-11-01T13:00:00Z'), localizado_en: null, seguimiento_etapa: 0,
  tiene_foto: false, total_registros: 1, numero_denuncia: NUMERO, reportado_por_usr_id: DUENO,
  proximo_seguimiento: new Date('2026-11-03T13:00:00Z'), checklist_denuncia: true, ...extra
});

test('serialización: la pública no lleva el número; la del dueño y la del administrador sí', () => {
  const publica = toPublicCase(fila());
  assert.ok(!('numeroDenuncia' in publica), 'toPublicCase no tiene la clave');
  assert.ok(!JSON.stringify(publica).includes(NUMERO), 'ni el valor en ningún otro campo');
  assert.equal(toOwnerCase(fila()).numeroDenuncia, NUMERO);
  assert.equal(toAdminCase(fila()).numeroDenuncia, NUMERO);
});

// authenticate revalida cada token contra la BD: id 11 es administrador, el resto ciudadano.
async function iniciar() {
  const consultas = [];
  const db = {
    async query(sql, values = []) {
      consultas.push({ sql, values });
      if (sql.includes('sesion_version FROM usuarios')) {
        return { rows: [{ rol: values[0] === ADMIN ? 'administrador' : 'ciudadano', sesion_version: 0 }] };
      }
      // "Mis casos": la base simulada respeta el filtro por reportante.
      if (sql.includes('WHERE reportado_por_usr_id = $1')) return { rows: values[0] === DUENO ? [fila()] : [] };
      if (sql.includes('FROM casos')) return { rows: [fila()] };
      return { rows: [] };
    }
  };
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pedir = async (ruta, usuario) => {
    const headers = usuario ? { Authorization: `Bearer ${jwt.sign({ id: usuario, rol: usuario === ADMIN ? 'administrador' : 'ciudadano' }, secret)}` } : {};
    const respuesta = await fetch(`${base}/api${ruta}`, { headers });
    return { status: respuesta.status, texto: await respuesta.text() };
  };
  return { pedir, consultas, cerrar: () => new Promise(resolve => server.close(resolve)) };
}

test('API: sin sesión y con la sesión de otro ciudadano, el listado y el detalle públicos no traen el número', async () => {
  const app = await iniciar();
  try {
    for (const usuario of [null, OTRO]) {
      for (const ruta of ['/casos', '/casos/cas_den', `/casos?q=${NUMERO}`]) {
        const { status, texto } = await app.pedir(ruta, usuario);
        assert.equal(status, 200, `${ruta} (${usuario ?? 'sin sesión'})`);
        assert.ok(!texto.includes(NUMERO), `${ruta} (${usuario ?? 'sin sesión'}) no debe incluir el número`);
        assert.ok(!texto.includes('numeroDenuncia'), `${ruta} (${usuario ?? 'sin sesión'}) no debe tener la clave`);
      }
    }
    // Otro ciudadano: "Mis casos" solo trae lo suyo, y el panel le está prohibido.
    const ajenos = await app.pedir('/mis-casos', OTRO);
    assert.equal(ajenos.status, 200);
    assert.deepEqual(JSON.parse(ajenos.texto).casos, []);
    assert.equal((await app.pedir('/admin/casos', OTRO)).status, 403);
    assert.equal((await app.pedir('/admin/casos', null)).status, 401);
    // La búsqueda pública no busca por número de denuncia.
    const busqueda = app.consultas.find(({ sql }) => sql.includes('ORDER BY creado_en DESC') && sql.includes('ILIKE'));
    assert.ok(busqueda, 'se hizo la búsqueda pública');
    assert.doesNotMatch(busqueda.sql.slice(busqueda.sql.indexOf('WHERE')), /numero_denuncia/);
  } finally {
    await app.cerrar();
  }
});

test('API: el dueño lo ve en "Mis casos" y el administrador en el panel', async () => {
  const app = await iniciar();
  try {
    const propios = await app.pedir('/mis-casos', DUENO);
    assert.equal(propios.status, 200);
    assert.equal(JSON.parse(propios.texto).casos[0].numeroDenuncia, NUMERO);
    const panel = await app.pedir('/admin/casos', ADMIN);
    assert.equal(panel.status, 200);
    assert.equal(JSON.parse(panel.texto).casos[0].numeroDenuncia, NUMERO);
  } finally {
    await app.cerrar();
  }
});

test('ficha: la pública nunca muestra el número; la del dueño y la vista previa sí', async () => {
  {
    const { renderCaseDetailHtml } = await import(new URL('../../public/js/feed.js', import.meta.url));
    const caso = {
      id: 'cas_den', nombreCompleto: 'Persona Pública', edad: 30, sexo: 'Femenino', ciudad: 'Asunción',
      descripcionFisica: 'Alta', vestimenta: 'Remera', estado: 'VALIDADO', fechaHoraDesaparicion: '2026-11-01T12:00:00Z',
      fotoUrl: '', numeroDenuncia: NUMERO
    };
    // Aunque el dato llegara por error, la ficha pública no lo muestra.
    const publica = renderCaseDetailHtml(caso);
    assert.ok(!publica.includes(NUMERO));
    assert.doesNotMatch(publica, /N\.º de denuncia/);
    assert.match(publica, /<strong>Denuncia policial:<\/strong> verificada por la administración \(el número no se publica\)\./);

    const propia = renderCaseDetailHtml(caso, { acciones: false, verDenuncia: true });
    assert.match(propia, /<strong>N\.º de denuncia:<\/strong> DEN-PRIVADA-777 <span class="muted">\(no se publica: solo lo ven vos y la administración\)<\/span>/);
    assert.doesNotMatch(propia, /verificada por la administración/, 'un caso propio puede estar en revisión');
    assert.match(renderCaseDetailHtml({ ...caso, numeroDenuncia: '' }, { verDenuncia: true }), /N\.º de denuncia:<\/strong> Sin registrar/);
  }
});
