import express from 'express';
import { datosAlerta, fotoPermitida } from '../public/js/alerta-campos.js';
import { camposDeAlerta, casoParaAlerta, ETIQUETA_NO_VERIFICADA } from './alertas.js';
import { asyncRoute } from './auth-routes.js';
import { caseVisibilityParameters, IMAGE_DATA_URL, PUBLIC_CASE_FILTER_JOINED, validCoordinates } from './case-shared.js';
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

  // Alerta del usuario para este caso, con los datos del caso que hacen falta para
  // la vista mínima. Solo quien recibió la alerta puede verla.
  const alertaDelUsuario = async (usuarioId, casoId) => (await db.query(`
    SELECT c.id, c.estado, c.nombre_completo, c.edad, c.sexo, c.ciudad, c.departamento,
      c.barrio, c.descripcion_fisica, c.vestimenta, c.alerta_campos, (c.foto <> '') AS tiene_foto,
      n.distancia_km, (${PUBLIC_CASE_FILTER_JOINED}) AS publico
    FROM notificaciones n JOIN casos c ON c.id = n.caso_id
    WHERE n.usuario_id = $2 AND n.caso_id = $3 AND n.tipo IN ('ALERTA_TEMPRANA', 'ALERTA_OFICIAL')
    ORDER BY n.creada_en DESC LIMIT 1
  `, [...caseVisibilityParameters(), usuarioId, casoId])).rows[0];

  // La foto va en la vista mínima solo si el reportante la eligió y la persona
  // es mayor de edad (se vuelve a comprobar acá, no solo al guardar).
  const muestraFoto = alerta => camposDeAlerta(alerta).includes('foto')
    && fotoPermitida(alerta.edad, alerta.tiene_foto);

  // Mientras el caso está en revisión, solo la vista mínima con los datos que eligió
  // el reportante; cuando el caso es público, la app abre la ficha completa.
  router.get('/alertas/:casoId', requireUser, asyncRoute(async (req, res) => {
    const alerta = await alertaDelUsuario(req.auth.id, req.params.casoId);
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
      datos: datosAlerta(casoParaAlerta(alerta), camposDeAlerta(alerta))
        .map(({ etiqueta, valor }) => ({ etiqueta, valor })),
      fotoUrl: muestraFoto(alerta) ? `/api/alertas/${encodeURIComponent(alerta.id)}/foto` : ''
    });
  }));

  router.get('/alertas/:casoId/foto', requireUser, asyncRoute(async (req, res) => {
    const alerta = await alertaDelUsuario(req.auth.id, req.params.casoId);
    if (!alerta || alerta.estado !== 'PENDIENTE' || !muestraFoto(alerta)) {
      return res.status(404).json({ error: 'Foto no disponible' });
    }
    const { rows } = await db.query('SELECT foto FROM casos WHERE id = $1', [alerta.id]);
    const match = typeof rows[0]?.foto === 'string' ? rows[0].foto.match(IMAGE_DATA_URL) : null;
    if (!match) return res.status(404).json({ error: 'Foto no disponible' });
    res.type(`image/${match[1]}`).set('Cache-Control', 'private, no-store').send(Buffer.from(match[2], 'base64'));
  }));

  return router;
}
