import express from 'express';
import { asyncRoute } from './auth-routes.js';

export function createNotificationRouter({ db, requireUser }) {
  const router = express.Router();

  router.get('/notificaciones', requireUser, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT id, caso_id, titulo, mensaje, tipo, leida, creada_en, distancia_km, canal,
        -- Puesta al día (alertas.js): la alerta temprana normal se guarda en la misma
        -- transacción que casos.alerta_temprana_en (misma hora); la puesta al día, después.
        (tipo = 'ALERTA_TEMPRANA' AND creada_en > (
          SELECT c.alerta_temprana_en FROM casos c WHERE c.id = notificaciones.caso_id
        )) AS puesta_al_dia
      FROM notificaciones WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 100
    `, [req.auth.id]);
    res.json({ notificaciones: rows.map(row => ({
      id: row.id,
      casoId: row.caso_id,
      titulo: row.titulo,
      mensaje: row.mensaje,
      tipo: row.tipo,
      leida: row.leida,
      fecha: row.creada_en,
      // Alertas de zona: distancia aproximada y si además salió por push.
      distanciaKm: row.distancia_km === null || row.distancia_km === undefined ? null : Number(row.distancia_km),
      canal: row.canal || 'app',
      // Solo centro de notificaciones: no sale como aviso del sistema (sin sonido).
      puestaAlDia: row.puesta_al_dia === true
    })) });
  }));

  router.post('/notificaciones/leidas', requireUser, asyncRoute(async (req, res) => {
    await db.query(
      'UPDATE notificaciones SET leida = TRUE WHERE usuario_id = $1',
      [req.auth.id]
    );
    res.json({ mensaje: 'Notificaciones marcadas como leídas.' });
  }));

  return router;
}
