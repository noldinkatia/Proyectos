// Alertas de zona (geocerca de 160 km): se arman dentro de la transacción que
// cambia el caso, así la notificación y el cambio se guardan juntos o ninguno.
import { distanciaSql, dentroDelRadioSql } from './geocerca.js';

export const LIMITE_ALERTA_TEMPRANA_HORAS = Number(process.env.LIMITE_ALERTA_TEMPRANA_HORAS ?? 24);

if (!Number.isFinite(LIMITE_ALERTA_TEMPRANA_HORAS) || LIMITE_ALERTA_TEMPRANA_HORAS < 0) {
  throw new Error('LIMITE_ALERTA_TEMPRANA_HORAS debe ser un número mayor o igual a cero.');
}

export const ETIQUETA_NO_VERIFICADA = 'Pendiente / En revisión – No verificada';

// Nombre comparable para detectar duplicados: sin tildes, mayúsculas ni signos.
export function normalizarNombre(nombre) {
  return String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Duplicado crítico: otro caso activo con el mismo nombre normalizado, edad ±1
// año, a 160 km o menos y creado en los últimos 30 días.
async function buscarDuplicadoCritico(client, caso) {
  const { rows } = await client.query(`
    SELECT c.id, c.nombre_completo FROM casos c
    WHERE c.id <> $1
      AND c.estado IN ('PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO')
      AND c.creado_en >= CURRENT_TIMESTAMP - INTERVAL '30 days'
      AND c.edad BETWEEN $2::integer - 1 AND $2::integer + 1
      AND ${dentroDelRadioSql(distanciaSql('c', '$3', '$4'))}
  `, [caso.id, caso.edad, caso.latitud, caso.longitud]);
  const nombre = normalizarNombre(caso.nombre_completo);
  return rows.find(row => normalizarNombre(row.nombre_completo) === nombre) || null;
}

async function superaLimitePorReportante(client, caso) {
  if (!caso.reportado_por_usr_id || LIMITE_ALERTA_TEMPRANA_HORAS === 0) return false;
  // Dos reportes simultáneos del mismo usuario no pueden pasar el límite a la vez.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`alerta_temprana:${caso.reportado_por_usr_id}`]);
  const { rows } = await client.query(`
    SELECT 1 FROM casos
    WHERE reportado_por_usr_id = $1 AND id <> $2
      AND alerta_temprana_en > CURRENT_TIMESTAMP - ($3 * INTERVAL '1 hour')
    LIMIT 1
  `, [caso.reportado_por_usr_id, caso.id, LIMITE_ALERTA_TEMPRANA_HORAS]);
  return rows.length > 0;
}

function textoAlertaTemprana(caso) {
  const zona = [caso.barrio, caso.ciudad, caso.departamento].filter(Boolean).join(', ');
  return `${ETIQUETA_NO_VERIFICADA}. Zona: ${zona}.`;
}

// Usuarios con alertas de zona activas dentro del radio del caso, con su
// distancia. Nunca el reportante ni la administración.
const DESTINATARIOS_EN_RADIO = `
  SELECT a.usuario_id, ${distanciaSql('a', '$1', '$2')} AS distancia
  FROM alertas_zona a JOIN usuarios u ON u.id = a.usuario_id
  WHERE u.rol = 'ciudadano' AND u.verificado AND a.usuario_id IS DISTINCT FROM $3::integer
`;

// 'push' si el push está configurado y el usuario tiene algún dispositivo
// suscrito; si no, 'app' (solo el centro de notificaciones).
function canalSql(columnaUsuario, parametroPush) {
  return `CASE WHEN ${parametroPush}::boolean AND EXISTS (
    SELECT 1 FROM suscripciones_push s WHERE s.usuario_id = ${columnaUsuario}
  ) THEN 'push' ELSE 'app' END`;
}

// Al registrar un reporte: alerta temprana a la zona, salvo duplicado crítico o
// si el reportante ya generó una dentro del límite de horas.
export async function enviarAlertaTemprana(client, caso, { push } = {}) {
  const duplicado = await buscarDuplicadoCritico(client, caso);
  if (duplicado) {
    await client.query(`
      INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
      SELECT id, $1, 'Posible reporte duplicado', $2, 'CASO_POSIBLE_DUPLICADO'
      FROM usuarios WHERE rol = 'administrador'
    `, [caso.id, `El reporte se parece a otro caso activo (${duplicado.id}): no se envió alerta temprana a la zona.`]);
    return { enviada: false, motivo: 'duplicado', notificaciones: [] };
  }
  if (await superaLimitePorReportante(client, caso)) {
    return { enviada: false, motivo: 'limite', notificaciones: [] };
  }
  const { rows } = await client.query(`
    WITH zona AS (${DESTINATARIOS_EN_RADIO})
    INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, distancia_km, canal)
    SELECT z.usuario_id, $4, 'Alerta en tu zona: caso en revisión', $5, 'ALERTA_TEMPRANA',
      ROUND(z.distancia::numeric, 1), ${canalSql('z.usuario_id', '$6')}
    FROM zona z WHERE ${dentroDelRadioSql('z.distancia')}
    ON CONFLICT DO NOTHING
    RETURNING id, usuario_id, canal
  `, [caso.latitud, caso.longitud, caso.reportado_por_usr_id, caso.id, textoAlertaTemprana(caso),
    Boolean(push?.disponible)]);
  await client.query('UPDATE casos SET alerta_temprana_en = CURRENT_TIMESTAMP WHERE id = $1', [caso.id]);
  return { enviada: true, motivo: null, notificaciones: rows };
}

// Quienes recibieron una alerta (temprana u oficial) de este caso y siguen con las
// alertas de zona activas: si las desactivaron, no se les manda nada más.
const ALERTADOS_ACTIVOS = `
  SELECT n.usuario_id, MIN(n.distancia_km) AS distancia_km
  FROM notificaciones n JOIN alertas_zona a ON a.usuario_id = n.usuario_id
  WHERE n.caso_id = $1 AND n.tipo IN ('ALERTA_TEMPRANA', 'ALERTA_OFICIAL')
  GROUP BY n.usuario_id
`;

// Al validar: alerta oficial (el caso ya es público) a la zona actual y a quienes
// recibieron la alerta temprana aunque ya no estén dentro del radio.
async function alertaOficial(client, caso, push) {
  const { rows } = await client.query(`
    WITH zona AS (${DESTINATARIOS_EN_RADIO})
    INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, distancia_km, canal)
    SELECT z.usuario_id, $4, 'Alerta oficial en tu zona', $5, 'ALERTA_OFICIAL',
      ROUND(z.distancia::numeric, 1), ${canalSql('z.usuario_id', '$6')}
    FROM zona z
    WHERE ${dentroDelRadioSql('z.distancia')}
      OR z.usuario_id IN (SELECT usuario_id FROM notificaciones WHERE caso_id = $4 AND tipo = 'ALERTA_TEMPRANA')
    ON CONFLICT DO NOTHING
    RETURNING id, usuario_id, canal
  `, [caso.latitud, caso.longitud, caso.reportado_por_usr_id, caso.id,
    `Persona desaparecida en ${caso.ciudad}. El caso fue verificado por la administración: abrí la ficha para ver los datos.`,
    Boolean(push?.disponible)]);
  return rows;
}

// Al rechazar: la retractación queda solo en el centro de notificaciones (canal
// 'app'); nunca sale como push.
async function retractacion(client, caso) {
  await client.query(`
    INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, distancia_km, canal)
    SELECT d.usuario_id, $1, 'Alerta retirada', $2, 'ALERTA_RETRACTADA', d.distancia_km, 'app'
    FROM (${ALERTADOS_ACTIVOS}) d
    ON CONFLICT DO NOTHING
  `, [caso.id, 'El caso en revisión de tu zona no fue validado por la administración. No hace falta que hagas nada.']);
  return [];
}

// Al localizar: los suscritos al caso ya reciben CASO_LOCALIZADO; acá se avisa
// al resto de los alertados.
async function avisoLocalizado(client, caso, push) {
  const { rows } = await client.query(`
    INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, distancia_km, canal)
    SELECT d.usuario_id, $1, 'Caso de tu zona resuelto', $2, 'ALERTA_LOCALIZADO', d.distancia_km,
      ${canalSql('d.usuario_id', '$4')}
    FROM (${ALERTADOS_ACTIVOS}) d
    WHERE d.usuario_id IS DISTINCT FROM $3::integer
      AND d.usuario_id NOT IN (SELECT usuario_id FROM suscripciones_caso WHERE caso_id = $1)
    ON CONFLICT DO NOTHING
    RETURNING id, usuario_id, canal
  `, [caso.id, 'La persona del caso de tu zona fue localizada. Gracias por estar atento.', caso.reportado_por_usr_id,
    Boolean(push?.disponible)]);
  return rows;
}

// Al cerrar: solo en el centro de notificaciones, a los suscritos al caso y a
// los alertados (el reportante ya recibe CASO_CERRADO).
async function avisoCerrado(client, caso) {
  await client.query(`
    INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, distancia_km, canal)
    SELECT d.usuario_id, $1, 'Caso cerrado', $2, 'ALERTA_CERRADO', MIN(d.distancia_km), 'app'
    FROM (
      ${ALERTADOS_ACTIVOS}
      UNION ALL
      SELECT usuario_id, NULL FROM suscripciones_caso WHERE caso_id = $1
    ) d
    WHERE d.usuario_id IS DISTINCT FROM $3::integer
    GROUP BY d.usuario_id
    ON CONFLICT DO NOTHING
  `, [caso.id, 'Un caso que seguías fue cerrado y ya no está activo en tu zona.', caso.reportado_por_usr_id]);
  return [];
}

// Avisos de zona por cambio de estado (administración o seguimiento del
// reportante). Apaga la geocerca al localizar, cerrar o rechazar, y devuelve las
// notificaciones creadas que pueden salir por push.
export async function alertasPorCambioDeEstado(client, caso, estadoNuevo, { push } = {}) {
  await client.query('UPDATE casos SET geocerca_activa = $2 WHERE id = $1',
    [caso.id, ['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO'].includes(estadoNuevo)]);
  if (estadoNuevo === 'VALIDADO' && !['VALIDADO', 'EN_SEGUIMIENTO'].includes(caso.estado)) {
    return alertaOficial(client, caso, push);
  }
  if (estadoNuevo === 'RECHAZADO') return retractacion(client, caso);
  if (estadoNuevo === 'LOCALIZADO') return avisoLocalizado(client, caso, push);
  if (estadoNuevo === 'CERRADO') return avisoCerrado(client, caso);
  return [];
}

// Pista nueva: además del aviso a la administración (que ya existe), uno al
// reportante, sin el contenido de la pista y sin repetirlo mientras no lo lea.
export async function avisarPistaAlReportante(client, casoId, autorId) {
  await client.query(`
    INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
    SELECT c.reportado_por_usr_id, c.id, 'Nueva pista para tu caso', $3, 'PISTA_RECIBIDA_REPORTANTE'
    FROM casos c
    WHERE c.id = $1 AND c.reportado_por_usr_id IS NOT NULL
      AND c.reportado_por_usr_id IS DISTINCT FROM $2::integer
      AND NOT EXISTS (
        SELECT 1 FROM notificaciones n
        WHERE n.usuario_id = c.reportado_por_usr_id AND n.caso_id = c.id
          AND n.tipo = 'PISTA_RECIBIDA_REPORTANTE' AND NOT n.leida
      )
  `, [casoId, autorId, 'Llegó una pista sobre tu caso. La administración la revisa antes de publicarla.']);
}
