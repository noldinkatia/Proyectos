// Notificaciones Web Push (VAPID). Sin VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y
// VAPID_SUBJECT el push queda desactivado y las alertas llegan solo al centro de
// notificaciones. Nunca se registran claves ni endpoints en los logs.
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { avisoPushAlertaTemprana, distanciaAproximada } from '../public/js/alerta-campos.js';
import { camposDeAlerta, casoParaAlerta } from './alertas.js';

const UN_DIA_SEGUNDOS = 24 * 60 * 60;
const ENVIOS_SIMULTANEOS = 10;

// Más de este número de alertas tempranas por push en una hora para la misma
// persona: en vez de una por una, un único aviso que las agrupa. 0 = sin agrupar.
export const LIMITE_PUSH_TEMPRANAS_POR_HORA = Number(process.env.LIMITE_PUSH_TEMPRANAS_POR_HORA ?? 3);

if (!Number.isInteger(LIMITE_PUSH_TEMPRANAS_POR_HORA) || LIMITE_PUSH_TEMPRANAS_POR_HORA < 0) {
  throw new Error('LIMITE_PUSH_TEMPRANAS_POR_HORA debe ser un número entero mayor o igual a cero.');
}

// Mismo tag (en el dispositivo) y topic (en el servicio push) por caso: un aviso
// nuevo del mismo caso reemplaza al anterior en vez de acumularse.
const tagCaso = casoId => `rastreo-caso-${casoId}`;
const topicCaso = casoId => createHash('sha256').update(String(casoId)).digest('base64url').slice(0, 32);
const TAG_AGRUPADAS = 'rastreo-alertas-agrupadas';
const BOTON_VER = [{ accion: 'ver', titulo: 'Ver' }];

// Lo que se muestra en el dispositivo: sin nombre, edad, foto ni ubicación
// exacta de la persona. Los detalles se ven al abrir la app.
// discreta: sin sonido ni vibración (public/sw.js). La oficial no es discreta:
// suena, vibra, queda en pantalla hasta que se toca y vuelve a sonar si llega
// otro aviso del mismo caso.
// caso: la fila de casos (ciudad y barrio, si el reportante los eligió).
// distanciaKm: la de quien recibe el aviso.
export function cargaPush(tipo, casoId, caso = {}, { distanciaKm = null } = {}) {
  const id = encodeURIComponent(casoId);
  if (tipo === 'ALERTA_TEMPRANA') {
    const { titulo, cuerpo } = avisoPushAlertaTemprana(casoParaAlerta(caso), camposDeAlerta(caso), distanciaKm);
    return {
      carga: { titulo, cuerpo, url: `/app/#/alerta/${id}`, tag: tagCaso(casoId), discreta: true, acciones: BOTON_VER },
      opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'low', topic: topicCaso(casoId) }
    };
  }
  if (tipo === 'ALERTA_OFICIAL') {
    // El caso ya es público: la ciudad se puede mostrar.
    const ciudad = String(caso.ciudad || '').trim().slice(0, 60);
    const distancia = distanciaAproximada(distanciaKm);
    return {
      carga: {
        titulo: ciudad ? `Alerta oficial · ${ciudad}` : 'Alerta oficial en tu zona',
        cuerpo: `Persona desaparecida ${distancia || 'en tu zona'}. Caso verificado por la administración: tocá para ver la ficha.`,
        url: `/app/#/caso/${id}`, tag: tagCaso(casoId), discreta: false
      },
      opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'high', topic: topicCaso(casoId) }
    };
  }
  if (tipo === 'ALERTA_LOCALIZADO') {
    return {
      carga: { titulo: 'Caso resuelto en tu zona', cuerpo: 'La persona fue localizada. Gracias por estar atento.', url: '/app/#/alertas', tag: tagCaso(casoId), discreta: true },
      opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'low', topic: topicCaso(casoId) }
    };
  }
  return null;
}

// Un solo aviso para varias alertas tempranas seguidas: reemplaza al agrupado
// anterior (mismo tag en el dispositivo y mismo topic en el servicio push).
export function cargaPushAgrupada(cantidad) {
  return {
    carga: {
      titulo: 'Alertas en tu zona',
      cuerpo: `Hay ${cantidad} casos en revisión en tu zona. Aún no están verificados.`,
      url: '/app/#/alertas', tag: TAG_AGRUPADAS, discreta: true, acciones: BOTON_VER
    },
    opciones: { TTL: UN_DIA_SEGUNDOS, urgency: 'low', topic: 'alertas-agrupadas' }
  };
}

function resultadoFinal(estados) {
  if (estados.includes('enviado')) return 'enviado';
  if (estados.includes('fallido')) return 'fallido';
  if (estados.includes('caducado')) return 'caducado';
  return 'sin_dispositivo';
}

// Envía las notificaciones (ya guardadas con canal 'push') a cada dispositivo del
// usuario y anota el resultado en notificaciones.push_resultado. Una que ya
// tiene resultado no se vuelve a enviar.
export async function entregarPush(db, push, ids) {
  const { rows } = await db.query(`
    SELECT n.id, n.tipo, n.caso_id, n.distancia_km, c.ciudad, c.barrio, c.alerta_campos,
      s.id AS suscripcion_id, s.endpoint, s.p256dh, s.auth,
      (SELECT COUNT(*)::integer FROM notificaciones r
        WHERE r.usuario_id = n.usuario_id AND r.tipo = 'ALERTA_TEMPRANA' AND r.canal = 'push'
          AND r.creada_en > CURRENT_TIMESTAMP - INTERVAL '1 hour' AND r.id <= n.id) AS tempranas_ultima_hora
    FROM notificaciones n
    JOIN casos c ON c.id = n.caso_id
    JOIN alertas_zona a ON a.usuario_id = n.usuario_id
    JOIN suscripciones_push s ON s.usuario_id = n.usuario_id
    WHERE n.id = ANY($1::bigint[]) AND n.canal = 'push' AND n.push_resultado IS NULL
  `, [ids]);
  const estados = new Map(rows.map(row => [String(row.id), []]));
  const limite = push.limiteTempranasPorHora;
  const enviarUno = async row => {
    const agrupar = row.tipo === 'ALERTA_TEMPRANA' && limite > 0 && row.tempranas_ultima_hora > limite;
    const mensaje = agrupar
      ? cargaPushAgrupada(row.tempranas_ultima_hora)
      : cargaPush(row.tipo, row.caso_id, row, { distanciaKm: row.distancia_km });
    if (!mensaje) return;
    try {
      await push.enviar(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ ...mensaje.carga, casoId: agrupar ? null : row.caso_id, tipo: row.tipo, agrupada: agrupar }),
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
  // Sin filas: el usuario ya no tiene dispositivo (o la notificación ya tenía resultado).
  await db.query(`
    UPDATE notificaciones n SET push_resultado = COALESCE(r.resultado, 'sin_dispositivo')
    FROM unnest($1::bigint[]) AS i(id)
    LEFT JOIN unnest($2::bigint[], $3::text[]) AS r(id, resultado) ON r.id = i.id
    WHERE n.id = i.id AND n.push_resultado IS NULL
  `, [ids, pares.map(([id]) => id), pares.map(([, resultado]) => resultado)]);
}

// cliente: la librería web-push, o un reemplazo en los tests.
// limiteTempranasPorHora: ver LIMITE_PUSH_TEMPRANAS_POR_HORA.
export function crearPush({ publicKey, privateKey, subject, cliente = webpush, limiteTempranasPorHora = LIMITE_PUSH_TEMPRANAS_POR_HORA } = {}) {
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
    limiteTempranasPorHora,
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
