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

// Al registrar un reporte: alerta temprana a la zona, salvo duplicado crítico o
// si el reportante ya generó una dentro del límite de horas.
export async function enviarAlertaTemprana(client, caso) {
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
      ROUND(z.distancia::numeric, 1), 'app'
    FROM zona z WHERE ${dentroDelRadioSql('z.distancia')}
    ON CONFLICT DO NOTHING
    RETURNING id, usuario_id, canal
  `, [caso.latitud, caso.longitud, caso.reportado_por_usr_id, caso.id, textoAlertaTemprana(caso)]);
  await client.query('UPDATE casos SET alerta_temprana_en = CURRENT_TIMESTAMP WHERE id = $1', [caso.id]);
  return { enviada: true, motivo: null, notificaciones: rows };
}
