import express from 'express';
import { alertasPorCambioDeEstado } from './alertas.js';
import { asyncRoute } from './auth-routes.js';
import {
  caseListColumns,
  casoEncontrado,
  paginatedBody,
  paginationFromQuery,
  sendStoredPhoto,
  toAdminCase,
  validDateFilter
} from './case-shared.js';
import { withTransaction } from './db.js';
import { avisoLocalizadoAlReportante, processDueFollowups } from './followups.js';

// Antecedentes activos de quien reportó el caso c (solo para el panel).
const ANTECEDENTES_ACTIVOS_DEL_REPORTANTE = `(
  SELECT COALESCE(json_agg(json_build_object(
    'id', ant.id::text, 'motivo', ant.motivo, 'registradoEn', ant.registrado_en,
    'registradoPor', reg.nombre_completo
  ) ORDER BY ant.registrado_en DESC), '[]'::json)
  FROM antecedentes_usuario ant LEFT JOIN usuarios reg ON reg.id = ant.registrado_por
  WHERE ant.usuario_id = c.reportado_por_usr_id AND ant.retirado_en IS NULL
)`;

// Panel de administración: listado y moderación de casos, auditoría, historial
// de localizados y simulador de seguimiento. Todas las rutas exigen administrador.
export function createAdminRouter({ db, requireAdmin, push }) {
  const router = express.Router();

  router.get('/admin/casos', ...requireAdmin, asyncRoute(async (req, res) => {
    const pagination = paginationFromQuery(req.query);
    const { rows } = await db.query(`
      SELECT ${caseListColumns('c')}, u.correo AS contacto_reportante,
        ${ANTECEDENTES_ACTIVOS_DEL_REPORTANTE} AS antecedentes_reportante,
        COUNT(*) OVER() AS total_registros
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      ORDER BY c.creado_en DESC
      LIMIT $1::integer OFFSET $2::integer
    `, [pagination.limit, pagination.offset]);
    res.json(paginatedBody('casos', rows.map(toAdminCase), rows, pagination));
  }));

  router.get('/admin/auditoria', ...requireAdmin, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT h.cambiado_en AS fecha, 'Caso' AS tipo_registro,
        c.nombre_completo AS persona, h.estado_anterior, h.estado_nuevo,
        a.nombre_completo AS administrador, NULL::text AS motivo
      FROM cambios_estado_caso h
      JOIN casos c ON c.id = h.caso_id
      LEFT JOIN usuarios a ON a.id = h.cambiado_por
      UNION ALL
      SELECT h.cambiado_en AS fecha, 'Pista' AS tipo_registro,
        c.nombre_completo AS persona, h.estado_anterior, h.estado_nuevo,
        a.nombre_completo AS administrador, h.motivo
      FROM cambios_estado_pista h
      JOIN pistas p ON p.id = h.pista_id
      JOIN casos c ON c.id = p.caso_id
      LEFT JOIN usuarios a ON a.id = h.cambiado_por
      UNION ALL
      -- Antecedentes: quién marcó a quién y quién retiró la marca, con el motivo.
      SELECT ant.registrado_en, 'Antecedente', u.nombre_completo, NULL, 'MARCADO',
        a.nombre_completo, ant.motivo
      FROM antecedentes_usuario ant
      JOIN usuarios u ON u.id = ant.usuario_id
      LEFT JOIN usuarios a ON a.id = ant.registrado_por
      UNION ALL
      SELECT ant.retirado_en, 'Antecedente', u.nombre_completo, 'MARCADO', 'RETIRADO',
        a.nombre_completo, ant.motivo_retiro
      FROM antecedentes_usuario ant
      JOIN usuarios u ON u.id = ant.usuario_id
      LEFT JOIN usuarios a ON a.id = ant.retirado_por
      WHERE ant.retirado_en IS NOT NULL
      ORDER BY fecha DESC
      LIMIT 100
    `);
    res.json({ eventos: rows.map(row => ({
      fecha: row.fecha,
      tipoRegistro: row.tipo_registro,
      persona: row.persona,
      estadoAnterior: row.estado_anterior,
      estadoNuevo: row.estado_nuevo,
      administrador: row.administrador,
      motivo: row.motivo
    })) });
  }));

  router.get('/admin/casos/:id/foto', ...requireAdmin, asyncRoute((req, res) => sendStoredPhoto(db, req, res, true)));

  router.get('/admin/historial-localizados', ...requireAdmin, asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%%';
    const from = typeof req.query.desde === 'string' ? req.query.desde : null;
    const to = typeof req.query.hasta === 'string' ? req.query.hasta : null;
    if (!validDateFilter(from) || !validDateFilter(to)
      || (from && to && from > to)) {
      return res.status(400).json({ error: 'El rango de fechas no es válido.' });
    }
    const values = [search, from, to, limit, offset];
    const result = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'descripcion', p.descripcion, 'usuarioId', p.usuario_id,
          'nombreUsuario', pu.nombre_completo, 'correoUsuario', pu.correo,
          'fechaHoraAvistamiento', p.fecha_hora_avistamiento,
          'ubicacion', json_build_object('lat', p.latitud, 'lng', p.longitud, 'direccion', p.direccion),
          'fechaEnvio', p.fecha_envio
        ) ORDER BY p.fecha_envio DESC), '[]'::json) FROM pistas p
          LEFT JOIN usuarios pu ON pu.id = p.usuario_id WHERE p.caso_id = c.id) AS pistas,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', h.estado_anterior, 'estadoNuevo', h.estado_nuevo,
          'cambiadoPor', h.cambiado_por, 'cambiadoEn', h.cambiado_en,
          'nombreAdministrador', a.nombre_completo
        ) ORDER BY h.cambiado_en), '[]'::json) FROM cambios_estado_caso h
          LEFT JOIN usuarios a ON a.id = h.cambiado_por WHERE h.caso_id = c.id) AS cambios_estado,
        COUNT(*) OVER() AS total_registros
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      WHERE ${casoEncontrado('c.')}
        AND ($1 = '%%' OR c.nombre_completo ILIKE $1 OR c.ciudad ILIKE $1)
        AND ($2::date IS NULL OR c.localizado_en >= $2::date)
        AND ($3::date IS NULL OR c.localizado_en < $3::date + INTERVAL '1 day')
      ORDER BY c.localizado_en DESC LIMIT $4 OFFSET $5
    `, values);
    res.json({
      casos: result.rows.map(toAdminCase),
      pagina: page,
      limite: limit,
      total: Number(result.rows[0]?.total_registros || 0)
    });
  }));

  router.get('/admin/historial-localizados/:id', ...requireAdmin, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'descripcion', p.descripcion, 'usuarioId', p.usuario_id,
          'nombreUsuario', pu.nombre_completo, 'correoUsuario', pu.correo,
          'fechaHoraAvistamiento', p.fecha_hora_avistamiento,
          'ubicacion', json_build_object('lat', p.latitud, 'lng', p.longitud, 'direccion', p.direccion),
          'fechaEnvio', p.fecha_envio
        ) ORDER BY p.fecha_envio DESC), '[]'::json) FROM pistas p
          LEFT JOIN usuarios pu ON pu.id = p.usuario_id WHERE p.caso_id = c.id) AS pistas,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', h.estado_anterior, 'estadoNuevo', h.estado_nuevo,
          'cambiadoPor', h.cambiado_por, 'cambiadoEn', h.cambiado_en,
          'nombreAdministrador', a.nombre_completo
        ) ORDER BY h.cambiado_en), '[]'::json) FROM cambios_estado_caso h
          LEFT JOIN usuarios a ON a.id = h.cambiado_por WHERE h.caso_id = c.id) AS cambios_estado
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      WHERE c.id = $1 AND ${casoEncontrado('c.')}
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toAdminCase(rows[0]) });
  }));

  router.post('/admin/casos/:id/estado', ...requireAdmin, asyncRoute(async (req, res) => {
    const state = req.body?.estado;
    if (!['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO'].includes(state)) {
      return res.status(400).json({ error: 'El estado solicitado no es válido.' });
    }
    // Un motivo de solo espacios no cuenta. Se guarda sin los espacios de más.
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (state === 'RECHAZADO' && !motivo) {
      return res.status(400).json({ error: 'Debe indicar el motivo del rechazo.' });
    }
    if (state === 'PENDIENTE' && !motivo) {
      return res.status(400).json({ error: 'Debe indicar qué debe corregirse antes de volver a validar el caso.' });
    }
    if (state === 'VALIDADO'
      && (typeof req.body?.numeroDenuncia !== 'string' || !req.body.numeroDenuncia.trim())) {
      return res.status(400).json({ error: 'Debe registrar el número oficial de denuncia.' });
    }
    if (state === 'VALIDADO' && [
      'verificoDenuncia',
      'datosCoherentes',
      'duplicadosVerificados',
      'menorValidado'
    ].some(key => req.body?.[key] !== true)) {
      return res.status(400).json({ error: 'Debe completar toda la lista de validación antes de publicar el caso.' });
    }
    if (state === 'CERRADO' && !motivo) {
      return res.status(400).json({ error: 'Debe indicar la justificación para cerrar el caso.' });
    }
    let alertasPush = [];
    const updated = await withTransaction(db, async client => {
      const { rows } = await client.query('SELECT * FROM casos WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) return null;
      const current = rows[0];
      if (current.estado === state) return current;
      const { rows: updatedRows } = await client.query(`
        UPDATE casos SET estado = $2,
          -- Al cerrar se conserva la fecha de localizado: sigue contando como encontrado.
          localizado_en = CASE WHEN $2 = 'LOCALIZADO' THEN CURRENT_TIMESTAMP
            WHEN $2 = 'CERRADO' THEN localizado_en ELSE NULL END,
          motivo_rechazo = CASE WHEN $2 = 'RECHAZADO' THEN $3 ELSE motivo_rechazo END,
          motivo_cierre = CASE WHEN $2 = 'CERRADO' THEN $3 ELSE motivo_cierre END,
          numero_denuncia = CASE WHEN $2 = 'VALIDADO' AND $4 <> '' THEN $4 ELSE numero_denuncia END,
          checklist_denuncia = CASE WHEN $2 = 'VALIDADO' THEN $5 ELSE checklist_denuncia END,
          checklist_coherencia = CASE WHEN $2 = 'VALIDADO' THEN $6 ELSE checklist_coherencia END,
          checklist_duplicados = CASE WHEN $2 = 'VALIDADO' THEN $7 ELSE checklist_duplicados END,
          checklist_menores = CASE WHEN $2 = 'VALIDADO' THEN $8 ELSE checklist_menores END,
          proximo_seguimiento = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 NOT IN ('VALIDADO', 'EN_SEGUIMIENTO')
              THEN CURRENT_TIMESTAMP + INTERVAL '48 hours'
            WHEN $2 IN ('LOCALIZADO', 'CERRADO', 'RECHAZADO', 'PENDIENTE') THEN NULL
            ELSE proximo_seguimiento
          END,
          seguimiento_etapa = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 NOT IN ('VALIDADO', 'EN_SEGUIMIENTO') THEN 0
            WHEN $2 IN ('LOCALIZADO', 'CERRADO', 'RECHAZADO', 'PENDIENTE') THEN 2
            ELSE seguimiento_etapa
          END,
          -- Entre VALIDADO y EN_SEGUIMIENTO la consulta en curso sigue; cualquier
          -- otro cambio la reinicia.
          seguimiento_intentos = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 IN ('VALIDADO', 'EN_SEGUIMIENTO') THEN seguimiento_intentos
            ELSE 0
          END
        WHERE id = $1 RETURNING *
      `, [
        req.params.id, state, motivo || null, req.body?.numeroDenuncia || '',
        req.body?.verificoDenuncia === true, req.body?.datosCoherentes === true,
        req.body?.duplicadosVerificados === true, req.body?.menorValidado === true,
        current.estado
      ]);
      await client.query(`
        INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por)
        VALUES ($1, $2, $3, $4)
      `, [req.params.id, current.estado, state, req.auth.id]);
      alertasPush = await alertasPorCambioDeEstado(client, current, state, { push });
      if (current.reportado_por_usr_id) {
        const caseName = current.nombre_completo;
        const reason = motivo;
        const transition = state === 'VALIDADO'
          ? ['Reporte aprobado', `El reporte de ${caseName} fue aprobado y publicado.`, 'CASO_VALIDADO']
          : state === 'PENDIENTE'
            ? ['Reporte devuelto a revisión', `El reporte de ${caseName} volvió a revisión.${reason ? ` Observación: ${reason}` : ''}`, 'CASO_REVISION']
            : state === 'RECHAZADO'
              ? ['Reporte rechazado', `El reporte de ${caseName} fue rechazado: ${reason}`, 'CASO_RECHAZADO']
              : state === 'EN_SEGUIMIENTO'
                ? ['Seguimiento actualizado', `El caso de ${caseName} pasó a seguimiento.`, 'CASO_SEGUIMIENTO']
                : state === 'CERRADO'
                  ? ['Caso cerrado', `El caso de ${caseName} fue cerrado: ${reason}`, 'CASO_CERRADO']
                  : null;
        if (transition) {
          await client.query(`
            INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
            VALUES ($1, $2, $3, $4, $5)
          `, [current.reportado_por_usr_id, req.params.id, ...transition]);
        }
      }
      if (state === 'LOCALIZADO') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Caso resuelto', $2, 'CASO_LOCALIZADO'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [req.params.id, `El caso de ${current.nombre_completo} fue resuelto: la persona fue localizada.`]);
        await avisoLocalizadoAlReportante(client, current);
      }
      return updatedRows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Caso no disponible' });
    push.programar(db, alertasPush);
    res.json({ caso: toAdminCase(updated) });
  }));

  router.post('/admin/simulador/avanzar-48h', ...requireAdmin, asyncRoute(async (_req, res) => {
    await db.query(`
      UPDATE casos SET proximo_seguimiento = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO')
        AND seguimiento_etapa IN (0, 1)
        AND proximo_seguimiento IS NOT NULL
    `);
    // Un paso por vez: la primera pregunta, la segunda y "Sin actualizar" salen en
    // tres simulaciones seguidas (cada una vence el próximo plazo pendiente).
    const result = { consultasEnviadas: 0, segundasConsultas: 0, casosEnSeguimiento: 0 };
    let batch;
    do {
      batch = await processDueFollowups(db);
      result.consultasEnviadas += batch.consultasEnviadas;
      result.segundasConsultas += batch.segundasConsultas;
      result.casosEnSeguimiento += batch.casosEnSeguimiento;
    } while (batch.consultasEnviadas + batch.segundasConsultas + batch.casosEnSeguimiento === 50);
    res.json({ mensaje: 'Simulación completada.', ...result });
  }));

  // Antecedente de reporte falso o abusivo (migración 008): solo administración y
  // solo sobre cuentas de ciudadanos. No bloquea nada: el panel lo muestra al
  // revisar sus reportes.
  router.post('/admin/usuarios/:id/antecedentes', ...requireAdmin, asyncRoute(async (req, res) => {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) return res.status(400).json({ error: 'Debe indicar el motivo del antecedente.' });
    const usuarioId = Number(req.params.id);
    if (!Number.isInteger(usuarioId)) return res.status(404).json({ error: 'Usuario no disponible.' });
    const { rows: usuarios } = await db.query("SELECT id FROM usuarios WHERE id = $1 AND rol = 'ciudadano'", [usuarioId]);
    if (!usuarios[0]) return res.status(404).json({ error: 'Usuario no disponible.' });
    const { rows } = await db.query(`
      INSERT INTO antecedentes_usuario (usuario_id, motivo, registrado_por)
      VALUES ($1, $2, $3) RETURNING *
    `, [usuarioId, motivo, req.auth.id]);
    res.status(201).json({ antecedente: aAntecedente(rows[0]) });
  }));

  // Retirar no borra: queda en el historial con quién, cuándo y por qué.
  router.post('/admin/antecedentes/:id/retirar', ...requireAdmin, asyncRoute(async (req, res) => {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) return res.status(400).json({ error: 'Debe indicar el motivo para retirar la marca.' });
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'El antecedente no existe o ya fue retirado.' });
    const { rows } = await db.query(`
      UPDATE antecedentes_usuario
      SET retirado_en = CURRENT_TIMESTAMP, retirado_por = $2, motivo_retiro = $3
      WHERE id = $1 AND retirado_en IS NULL
      RETURNING *
    `, [req.params.id, req.auth.id, motivo]);
    if (!rows[0]) return res.status(404).json({ error: 'El antecedente no existe o ya fue retirado.' });
    res.json({ antecedente: aAntecedente(rows[0]) });
  }));

  return router;
}

function aAntecedente(row) {
  return {
    id: String(row.id), usuarioId: row.usuario_id, motivo: row.motivo,
    registradoPor: row.registrado_por, registradoEn: row.registrado_en,
    retiradoEn: row.retirado_en, retiradoPor: row.retirado_por, motivoRetiro: row.motivo_retiro
  };
}
