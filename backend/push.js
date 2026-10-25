// Notificaciones Web Push (VAPID). Sin VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y
// VAPID_SUBJECT el push queda desactivado y las alertas llegan solo al centro de
// notificaciones. Nunca se registran claves ni endpoints en los logs.
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { cuerpoPushAlertaTemprana } from '../public/js/alerta-campos.js';
import { camposDeAlerta, casoParaAlerta } from './alertas.js';

const UN_DIA_SEGUNDOS = 24 * 60 * 60;
const ENVIOS_SIMULTANEOS = 10;

// Mismo tag (en el dispositivo) y topic (en el servicio push) por caso: un aviso
// nuevo del mismo caso reemplaza al anterior en vez de acumularse.
const tagCaso = casoId => `rastreo-caso-${casoId}`;
const topicCaso = casoId => createHash('sha256').update(String(casoId)).digest('base64url').slice(0, 32);

// Lo que se muestra en el dispositivo: texto genérico, sin nombre, edad, foto ni
// ubicación de la persona. Los detalles se ven al abrir la app.
// caso: la fila de casos (para la ciudad, si el reportante la eligió).
export function cargaPush(tipo, casoId, caso = {}) {
  const id = encodeURIComponent(casoId);
  if (tipo === 'ALERTA_TEMPRANA') {
    return {
      carga: { titulo: 'Rastreo PY', cuerpo: cuerpoPushAlertaTemprana(casoParaAlerta(caso), camposDeAlerta(caso)), url: `/app/#/alerta/${id}`, tag: tagCaso(casoId), discreta: true },
      opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'low', topic: topicCaso(casoId) }
    };
  }
  if (tipo === 'ALERTA_OFICIAL') {
    return {
      carga: { titulo: 'Rastreo PY', cuerpo: 'Alerta oficial en tu zona: persona desaparecida. Abrí la app para ver la ficha.', url: `/app/#/caso/${id}`, tag: tagCaso(casoId), discreta: false },
      opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'normal', topic: topicCaso(casoId) }
    };
  }
  if (tipo === 'ALERTA_LOCALIZADO') {
    return {
      carga: { titulo: 'Rastreo PY', cuerpo: 'Actualización de una alerta de tu zona: la persona fue localizada.', url: '/app/#/alertas', tag: tagCaso(casoId), discreta: true },
      opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'low', topic: topicCaso(casoId) }
    };
  }
  return null;
}

function resultadoFinal(estados) {
  if (estados.includes('enviado')) return 'enviado';
  if (estados.includes('fallido')) return 'fallido';
  if (estados.includes('caducado')) return 'caducado';
  return 'sin_dispositivo';
}

// Envía las notificaciones (ya guardadas con canal 'push') a cada dispositivo del
// usuario y anota el resultado en notificaciones.push_resultado.
export async function entregarPush(db, push, ids) {
  const { rows } = await db.query(`
    SELECT n.id, n.tipo, n.caso_id, c.ciudad, c.alerta_campos,
      s.id AS suscripcion_id, s.endpoint, s.p256dh, s.auth
    FROM notificaciones n
    JOIN casos c ON c.id = n.caso_id
    JOIN alertas_zona a ON a.usuario_id = n.usuario_id
    JOIN suscripciones_push s ON s.usuario_id = n.usuario_id
    WHERE n.id = ANY($1::bigint[]) AND n.canal = 'push'
  `, [ids]);
  const estados = new Map(ids.map(id => [String(id), []]));
  const enviarUno = async row => {
    const mensaje = cargaPush(row.tipo, row.caso_id, row);
    if (!mensaje) return;
    try {
      await push.enviar(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ ...mensaje.carga, casoId: row.caso_id, tipo: row.tipo }),
        mensaje.opciones
      );
      estados.get(String(row.id)).push('enviado');
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await db.query('DELETE FROM suscripciones_push WHERE id = $1', [row.suscripcion_id]);
        estados.get(String(row.id)).push('caducado');
        return;
      }
      await db.query('UPDATE suscripciones_push SET ultimo_error_en = CURRENT_TIMESTAMP WHERE id = $1', [row.suscripcion_id]);
      console.error(`No se pudo enviar una notificación push (respuesta ${error.statusCode || 'sin código'}).`);
      estados.get(String(row.id)).push('fallido');
    }
  };
  for (let inicio = 0; inicio < rows.length; inicio += ENVIOS_SIMULTANEOS) {
    await Promise.all(rows.slice(inicio, inicio + ENVIOS_SIMULTANEOS).map(enviarUno));
  }
  const pares = [...estados].map(([id, lista]) => [id, resultadoFinal(lista)]);
  await db.query(`
    UPDATE notificaciones n SET push_resultado = r.resultado
    FROM unnest($1::bigint[], $2::text[]) AS r(id, resultado)
    WHERE n.id = r.id
  `, [pares.map(([id]) => id), pares.map(([, resultado]) => resultado)]);
}

// cliente: la librería web-push, o un reemplazo en los tests.
export function crearPush({ publicKey, privateKey, subject, cliente = webpush } = {}) {
  let disponible = Boolean(publicKey && privateKey && subject);
  if (disponible) {
    try {
      cliente.setVapidDetails(subject, publicKey, privateKey);
    } catch {
      console.error('Las variables VAPID_* no son válidas: las notificaciones push quedan desactivadas.');
      disponible = false;
    }
  }
  const pendientes = new Set();
  return {
    disponible,
    clavePublica: disponible ? publicKey : null,
    enviar: (suscripcion, carga, opciones) => cliente.sendNotification(suscripcion, carga, opciones),
    // Después del commit y sin demorar la respuesta HTTP.
    programar(db, notificaciones) {
      const ids = notificaciones.filter(item => item.canal === 'push').map(item => item.id);
      if (!disponible || !ids.length) return;
      const tarea = entregarPush(db, this, ids)
        .catch(error => console.error('No se pudieron enviar las notificaciones push:', error.message))
        .finally(() => pendientes.delete(tarea));
      pendientes.add(tarea);
    },
    // Para los tests: espera los envíos en curso.
    async esperar() {
      await Promise.all([...pendientes]);
    }
  };
}

export function pushDesdeEntorno() {
  return crearPush({
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT
  });
}
