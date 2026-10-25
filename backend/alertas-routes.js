import express from 'express';
import { ETIQUETA_NO_VERIFICADA } from './alertas.js';
import { asyncRoute } from './auth-routes.js';
import { caseVisibilityParameters, PUBLIC_CASE_FILTER_JOINED, validCoordinates } from './case-shared.js';
import { ubicacionAproximada } from './geocerca.js';

// "Alertas de mi zona": el ciudadano da su consentimiento y su ubicación
// aproximada; puede desactivarlas cuando quiera, y eso borra la ubicación.
// Las coordenadas nunca se devuelven ni se registran en los logs.
export function createAlertRouter({ db, requireCitizen, requireUser }) {
  const router = express.Router();

  router.get('/alertas-zona', ...requireCitizen, asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      'SELECT actualizada_en FROM alertas_zona WHERE usuario_id = $1',
      [req.auth.id]
    );
    res.json({ activa: Boolean(rows[0]), actualizadaEn: rows[0]?.actualizada_en || null });
  }));

  router.put('/alertas-zona', ...requireCitizen, asyncRoute(async (req, res) => {
    const lat = Number(req.body?.ubicacion?.lat);
    const lng = Number(req.body?.ubicacion?.lng);
    if (req.body?.consentimiento !== true) {
      return res.status(400).json({ error: 'Para activar las alertas de tu zona tenés que aceptar que se guarde tu ubicación aproximada.' });
    }
    if (!validCoordinates(lat, lng)) {
      return res.status(400).json({ error: 'La ubicación no es válida.' });
    }
    await db.query(`
      INSERT INTO alertas_zona (usuario_id, latitud, longitud)
      VALUES ($1, $2, $3)
      ON CONFLICT (usuario_id) DO UPDATE SET
        latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
        actualizada_en = CURRENT_TIMESTAMP
    `, [req.auth.id, ubicacionAproximada(lat), ubicacionAproximada(lng)]);
    res.json({ activa: true, mensaje: 'Alertas de tu zona activadas.' });
  }));

  router.delete('/alertas-zona', ...requireCitizen, asyncRoute(async (req, res) => {
    await db.query('DELETE FROM alertas_zona WHERE usuario_id = $1', [req.auth.id]);
    res.json({ activa: false, mensaje: 'Alertas desactivadas y ubicación borrada.' });
  }));

  // Lo que ve quien recibió la alerta de un caso. Mientras está en revisión, solo
  // la vista mínima; cuando el caso es público, la app abre la ficha completa.
  router.get('/alertas/:casoId', requireUser, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT c.id, c.estado, c.ciudad, c.departamento, c.barrio, n.distancia_km,
        (${PUBLIC_CASE_FILTER_JOINED}) AS publico
      FROM notificaciones n JOIN casos c ON c.id = n.caso_id
      WHERE n.usuario_id = $2 AND n.caso_id = $3 AND n.tipo IN ('ALERTA_TEMPRANA', 'ALERTA_OFICIAL')
      ORDER BY n.creada_en DESC LIMIT 1
    `, [...caseVisibilityParameters(), req.auth.id, req.params.casoId]);
    const alerta = rows[0];
    if (!alerta) return res.status(404).json({ error: 'Alerta no disponible' });
    const distanciaKm = alerta.distancia_km === null ? null : Number(alerta.distancia_km);
    if (alerta.publico) return res.json({ casoId: alerta.id, estado: 'PUBLICO', distanciaKm });
    if (alerta.estado !== 'PENDIENTE') {
      return res.json({ casoId: alerta.id, estado: alerta.estado === 'RECHAZADO' ? 'RETRACTADA' : 'FINALIZADA' });
    }
    res.json({
      casoId: alerta.id,
      estado: 'PENDIENTE',
      etiqueta: ETIQUETA_NO_VERIFICADA,
      distanciaKm,
      campos: { departamento: alerta.departamento, ciudad: alerta.ciudad, barrio: alerta.barrio || '' }
    });
  }));

  return router;
}
