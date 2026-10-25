import express from 'express';
import { ETIQUETA_NO_VERIFICADA } from './alertas.js';
import { asyncRoute } from './auth-routes.js';
import { caseVisibilityParameters, PUBLIC_CASE_FILTER_JOINED, validCoordinates } from './case-shared.js';
import { withTransaction } from './db.js';
import { ubicacionAproximada } from './geocerca.js';

// "Alertas de mi zona": el ciudadano da su consentimiento y su ubicación
// aproximada; puede desactivarlas cuando quiera, y eso borra la ubicación.
// Las coordenadas nunca se devuelven ni se registran en los logs.
// Suscripción Web Push del navegador (PushSubscription.toJSON()). null si no vino
// o no tiene la forma esperada.
function suscripcionValida(valor) {
  const endpoint = valor?.endpoint;
  const { p256dh, auth } = valor?.keys || {};
  const base64url = /^[A-Za-z0-9_-]+={0,2}$/;
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !/^https:\/\/\S+$/.test(endpoint)) return null;
  if (typeof p256dh !== 'string' || p256dh.length > 256 || !base64url.test(p256dh)) return null;
  if (typeof auth !== 'string' || auth.length > 256 || !base64url.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export function createAlertRouter({ db, requireCitizen, requireUser, push }) {
  const router = express.Router();

  router.get('/alertas-zona', ...requireCitizen, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT a.actualizada_en,
        (SELECT COUNT(*) FROM suscripciones_push s WHERE s.usuario_id = a.usuario_id) AS dispositivos
      FROM alertas_zona a WHERE a.usuario_id = $1
    `, [req.auth.id]);
    res.json({
      activa: Boolean(rows[0]),
      actualizadaEn: rows[0]?.actualizada_en || null,
      dispositivos: Number(rows[0]?.dispositivos || 0),
      push: { disponible: push.disponible, clavePublica: push.clavePublica }
    });
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
    const suscripcion = req.body?.suscripcion === undefined ? null : suscripcionValida(req.body.suscripcion);
    if (req.body?.suscripcion !== undefined && !suscripcion) {
      return res.status(400).json({ error: 'La suscripción de notificaciones del dispositivo no es válida.' });
    }
    await withTransaction(db, async client => {
      await client.query(`
        INSERT INTO alertas_zona (usuario_id, latitud, longitud)
        VALUES ($1, $2, $3)
        ON CONFLICT (usuario_id) DO UPDATE SET
          latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
          actualizada_en = CURRENT_TIMESTAMP
      `, [req.auth.id, ubicacionAproximada(lat), ubicacionAproximada(lng)]);
      // Un dispositivo es de una sola cuenta: si otra lo había suscrito, pasa a esta.
      if (suscripcion) {
        await client.query(`
          INSERT INTO suscripciones_push (usuario_id, endpoint, p256dh, auth)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (endpoint) DO UPDATE SET
            usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
            ultimo_error_en = NULL
        `, [req.auth.id, suscripcion.endpoint, suscripcion.p256dh, suscripcion.auth]);
      }
    });
    res.json({ activa: true, push: Boolean(suscripcion) && push.disponible, mensaje: 'Alertas de tu zona activadas.' });
  }));

  router.delete('/alertas-zona', ...requireCitizen, asyncRoute(async (req, res) => {
    await withTransaction(db, async client => {
      await client.query('DELETE FROM suscripciones_push WHERE usuario_id = $1', [req.auth.id]);
      await client.query('DELETE FROM alertas_zona WHERE usuario_id = $1', [req.auth.id]);
    });
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
