import { LIMITE_CIERRE_LOCALIZADO_DIAS } from './case-shared.js';
import { withTransaction } from './db.js';

// Seguimiento automático en dos intentos (seguimiento_intentos, migración 006):
//   48 h después de publicado (o de la última respuesta) → primera pregunta.
//   24 h sin respuesta → segunda pregunta, con las mismas opciones.
//   24 h más sin respuesta → EN_SEGUIMIENTO "Sin actualizar" y aviso a la
//   administración.
// Lo ejecuta server.js cada minuto y el simulador del admin (un paso por vez).
export async function processDueFollowups(db) {
  return withTransaction(db, async client => {
    const { rows: dueCases } = await client.query(`
      SELECT id, nombre_completo, reportado_por_usr_id, estado, seguimiento_etapa, seguimiento_intentos
      FROM casos
      WHERE proximo_seguimiento <= CURRENT_TIMESTAMP
        AND estado IN ('VALIDADO', 'EN_SEGUIMIENTO')
        AND seguimiento_etapa < 2
      ORDER BY proximo_seguimiento
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);
    const result = { consultasEnviadas: 0, segundasConsultas: 0, casosEnSeguimiento: 0 };

    for (const caso of dueCases) {
      const intentos = Number(caso.seguimiento_intentos) || 0;
      if (caso.seguimiento_etapa === 0 || intentos < 2) {
        const segunda = caso.seguimiento_etapa === 1;
        await client.query(`
          UPDATE casos SET seguimiento_etapa = 1, seguimiento_intentos = $2,
            proximo_seguimiento = CURRENT_TIMESTAMP + INTERVAL '24 hours'
          WHERE id = $1
        `, [caso.id, segunda ? 2 : 1]);
        if (caso.reportado_por_usr_id) {
          await client.query(`
            INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
            VALUES ($1, $2, $3, $4, 'SEGUIMIENTO')
          `, [
            caso.reportado_por_usr_id,
            caso.id,
            segunda ? 'Segunda consulta de seguimiento' : 'Consulta de seguimiento',
            segunda
              ? `Todavía no recibimos tu respuesta: ¿la búsqueda de ${caso.nombre_completo} continúa activa? Si no respondés en 24 horas, el caso quedará como sin actualizar.`
              : `¿La búsqueda de ${caso.nombre_completo} continúa activa? Responda dentro de las próximas 24 horas.`
          ]);
        }
        if (segunda) result.segundasConsultas += 1;
        else result.consultasEnviadas += 1;
        continue;
      }

      await client.query(`
        UPDATE casos SET estado = 'EN_SEGUIMIENTO', seguimiento_etapa = 2,
          proximo_seguimiento = NULL
        WHERE id = $1
      `, [caso.id]);
      if (caso.estado !== 'EN_SEGUIMIENTO') {
        await client.query(`
          INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo)
          VALUES ($1, $2, 'EN_SEGUIMIENTO')
        `, [caso.id, caso.estado]);
      }
      if (caso.reportado_por_usr_id) {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          VALUES ($1, $2, 'Seguimiento pendiente', $3, 'SEGUIMIENTO_VENCIDO')
        `, [caso.reportado_por_usr_id, caso.id, `El caso de ${caso.nombre_completo} pasó a seguimiento por falta de respuesta.`]);
      }
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT id, $1, 'Caso sin actualizar', $2, 'CASO_SIN_ACTUALIZAR'
        FROM usuarios WHERE rol = 'administrador'
      `, [caso.id, `El caso de ${caso.nombre_completo} no recibió respuesta a las dos consultas de seguimiento.`]);
      result.casosEnSeguimiento += 1;
    }
    return result;
  });
}

// Cierre automático: un caso localizado hace LIMITE_CIERRE_LOCALIZADO_DIAS días
// (7 por defecto) pasa a CERRADO, con la geocerca apagada y el cambio en el
// historial (sin autor: lo hizo el sistema). localizado_en se conserva, así sigue
// contando como encontrado. La ficha pública ya se había retirado a las
// VENTANA_LOCALIZADOS_HORAS. Lo ejecuta server.js cada minuto.
export async function processLocatedClosures(db, { dias = LIMITE_CIERRE_LOCALIZADO_DIAS } = {}) {
  return withTransaction(db, async client => {
    const { rows: vencidos } = await client.query(`
      SELECT id, nombre_completo, reportado_por_usr_id
      FROM casos
      WHERE estado = 'LOCALIZADO' AND localizado_en IS NOT NULL
        AND localizado_en + ($1 * INTERVAL '1 day') <= CURRENT_TIMESTAMP
      ORDER BY localizado_en
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `, [dias]);
    for (const caso of vencidos) {
      await client.query(`
        UPDATE casos SET estado = 'CERRADO', geocerca_activa = FALSE,
          motivo_cierre = $2, proximo_seguimiento = NULL,
          seguimiento_etapa = 2, seguimiento_intentos = 0
        WHERE id = $1
      `, [caso.id, `Cierre automático: ${dias} ${dias === 1 ? 'día' : 'días'} después de que la persona fue localizada.`]);
      await client.query(`
        INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo)
        VALUES ($1, 'LOCALIZADO', 'CERRADO')
      `, [caso.id]);
    }
    return { casosCerrados: vencidos.length };
  });
}
