/**
 * Carga datos de demostración en la base configurada en DATABASE_URL.
 *
 * Todos los registros son FICTICIOS y existen solo para poder recorrer la
 * aplicación con contenido. No representan denuncias reales.
 *
 * Es idempotente: borra lo que haya sembrado antes (todo lo que lleva el
 * prefijo "demo_") y vuelve a insertarlo. No toca ningún otro registro, así
 * que se puede correr sobre una base que ya tenga datos propios.
 *
 *   npm run seed:demo
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { deflateSync } from 'node:zlib';
import { createDatabase } from './db.js';
import { DECLARACION_VERSION } from '../public/js/declaracion.js';

// Credenciales de la cuenta de demostración. Son públicas a propósito: solo
// sirven en una base de demostración local.
const DEMO_EMAIL = 'ciudadano.demo@rastreopy.test';
const DEMO_PASSWORD = 'Demo-rastreo-2026';

const hoy = Date.now();
const hace = horas => new Date(hoy - horas * 3600 * 1000);
const dentroDe = horas => new Date(hoy + horas * 3600 * 1000);

// Imágenes de demostración dibujadas acá (PNG de 160 px): siluetas genéricas y una
// calle esquemática. Nunca la foto de una persona real. pixel(x, y, lado) → [r, g, b].
function png(pixel, lado = 160) {
  const filas = [];
  for (let y = 0; y < lado; y += 1) {
    const fila = [0];
    for (let x = 0; x < lado; x += 1) fila.push(...pixel(x, y, lado));
    filas.push(Buffer.from(fila));
  }
  const crc = buffer => {
    let c = ~0;
    for (const byte of buffer) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const control = Buffer.alloc(4);
    control.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, control]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera[8] = 8;
  cabecera[9] = 2;
  const archivo = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo('IHDR', cabecera), trozo('IDAT', deflateSync(Buffer.concat(filas))), trozo('IEND', Buffer.alloc(0))
  ]);
  return 'data:image/png;base64,' + archivo.toString('base64');
}
const silueta = (fondo, ropa) => png((x, y, lado) => {
  if ((x - lado / 2) ** 2 + (y - lado * 0.38) ** 2 < (lado * 0.17) ** 2) return [196, 164, 132];
  if ((x - lado / 2) ** 2 / (lado * 0.36) ** 2 + (y - lado * 1.02) ** 2 / (lado * 0.42) ** 2 < 1) return ropa;
  return fondo;
});
const FOTO = {
  azul: silueta([214, 226, 240], [53, 88, 127]),
  verde: silueta([220, 236, 228], [47, 110, 86]),
  arena: silueta([238, 230, 214], [138, 96, 64]),
  gris: silueta([228, 230, 236], [84, 96, 112])
};
const FOTO_PISTA = png((x, y, lado) => {
  if (y <= lado * 0.55) return [176, 206, 232];
  return Math.abs(y - lado * 0.78) < 2 && x % 24 < 12 ? [240, 240, 240] : [96, 100, 108];
});

const CASOS = [
  {
    id: 'demo_001',
    nombre_completo: 'Sofía Montserrat Giménez',
    edad: 16, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Capital',
    descripcion_fisica: 'Estatura 1,62 m, contextura delgada, cabello castaño largo.',
    vestimenta: 'Buzo gris con capucha, pantalón vaquero azul y zapatillas blancas.',
    senas_particulares: 'Lunar sobre la ceja izquierda.',
    fecha_hora_desaparicion: hace(50),
    latitud: -25.2985, longitud: -57.6359, direccion: 'Av. Eusebio Ayala y Santa Teresa',
    numero_denuncia: 'DEN-2026-00418', estado: 'EN_SEGUIMIENTO',
    proximo_seguimiento: hace(2), seguimiento_etapa: 2
  },
  {
    id: 'demo_002',
    nombre_completo: 'Carlos Alberto Benítez',
    edad: 42, sexo: 'Masculino', ciudad: 'Ciudad del Este', departamento: 'Alto Paraná',
    descripcion_fisica: 'Estatura 1,78 m, contextura robusta, cabello corto entrecano.',
    vestimenta: 'Camisa celeste a cuadros y pantalón de trabajo verde.',
    senas_particulares: 'Cicatriz en el antebrazo derecho.',
    fecha_hora_desaparicion: hace(20),
    latitud: -25.5097, longitud: -54.6111, direccion: 'Km 4 Monday',
    numero_denuncia: '', estado: 'PENDIENTE',
    proximo_seguimiento: null, seguimiento_etapa: 0, foto: FOTO.gris
  },
  {
    id: 'demo_003',
    nombre_completo: 'Rosa Elena Cabral',
    edad: 73, sexo: 'Femenino', ciudad: 'Luque', departamento: 'Central',
    descripcion_fisica: 'Estatura 1,55 m, cabello blanco corto, camina con bastón.',
    vestimenta: 'Vestido floreado y rebozo marrón.',
    senas_particulares: 'Desorientación por cuadro de demencia diagnosticado.',
    fecha_hora_desaparicion: hace(8),
    latitud: -25.2667, longitud: -57.4871, direccion: 'Barrio Mora Kue',
    numero_denuncia: 'DEN-2026-00431', estado: 'VALIDADO',
    proximo_seguimiento: dentroDe(40), seguimiento_etapa: 0, foto: FOTO.arena
  },
  {
    id: 'demo_004',
    nombre_completo: 'Mateo Villalba Ortiz',
    edad: 9, sexo: 'Masculino', ciudad: 'Encarnación', departamento: 'Itapúa',
    descripcion_fisica: 'Estatura 1,32 m, cabello negro lacio, ojos marrones.',
    vestimenta: 'Remera roja de fútbol y short azul.',
    senas_particulares: 'Usa anteojos recetados.',
    fecha_hora_desaparicion: hace(96),
    latitud: -27.3309, longitud: -55.8663, direccion: 'Costanera de Encarnación',
    numero_denuncia: 'DEN-2026-00377', estado: 'LOCALIZADO',
    proximo_seguimiento: null, seguimiento_etapa: 0, localizado_en: hace(3)
  },
  {
    id: 'demo_005',
    nombre_completo: 'Lucía Fernanda Ayala',
    edad: 27, sexo: 'Femenino', ciudad: 'Capiatá', departamento: 'Central',
    descripcion_fisica: 'Estatura 1,68 m, cabello rubio teñido hasta los hombros.',
    vestimenta: 'Campera de jean y pantalón negro.',
    senas_particulares: 'Tatuaje de una golondrina en la muñeca izquierda.',
    fecha_hora_desaparicion: hace(300),
    latitud: -25.3553, longitud: -57.4456, direccion: 'Ruta PY02 Km 20',
    numero_denuncia: 'DEN-2026-00188', estado: 'CERRADO',
    proximo_seguimiento: null, seguimiento_etapa: 0, motivo_cierre: 'Regresó por sus propios medios al domicilio familiar.'
  },
  {
    id: 'demo_006',
    nombre_completo: 'Diego Armando Recalde',
    edad: 34, sexo: 'Masculino', ciudad: 'Pedro Juan Caballero', departamento: 'Amambay',
    descripcion_fisica: 'Estatura 1,74 m, contextura media, barba candado.',
    vestimenta: 'Remera negra lisa y bermuda caqui.',
    senas_particulares: '',
    fecha_hora_desaparicion: hace(14),
    latitud: -22.5472, longitud: -55.7336, direccion: 'Barrio Obrero',
    numero_denuncia: 'DEN-2026-00440', estado: 'VALIDADO',
    proximo_seguimiento: dentroDe(34), seguimiento_etapa: 0, foto: FOTO.azul
  },
  {
    // Adulto localizado hace pocas horas: se ve en "Localizados (últimas 24 h)" y
    // todavía no se cerró solo (eso pasa a los 7 días).
    id: 'demo_007',
    nombre_completo: 'Ramón Esteban Duarte',
    edad: 58, sexo: 'Masculino', ciudad: 'San Lorenzo', departamento: 'Central',
    descripcion_fisica: 'Estatura 1,70 m, contextura media, bigote canoso.',
    vestimenta: 'Camisa blanca, pantalón gris y sombrero piri.',
    senas_particulares: 'Usa anteojos de marco negro.',
    fecha_hora_desaparicion: hace(30),
    latitud: -25.3396, longitud: -57.5089, direccion: 'Barrio Barcequillo',
    numero_denuncia: 'DEN-2026-00452', estado: 'LOCALIZADO',
    proximo_seguimiento: null, seguimiento_etapa: 2, localizado_en: hace(5), foto: FOTO.verde
  },
  {
    // En seguimiento con la primera consulta ya enviada (no "sin actualizar").
    id: 'demo_008',
    nombre_completo: 'Nilda Raquel Sosa',
    edad: 45, sexo: 'Femenino', ciudad: 'Villarrica', departamento: 'Guairá',
    descripcion_fisica: 'Estatura 1,60 m, cabello negro recogido.',
    vestimenta: 'Blusa roja y falda negra.',
    senas_particulares: 'Tatuaje pequeño de una flor en la muñeca.',
    fecha_hora_desaparicion: hace(70),
    latitud: -25.7810, longitud: -56.4466, direccion: 'Centro, cerca de la plaza',
    numero_denuncia: 'DEN-2026-00402', estado: 'EN_SEGUIMIENTO',
    proximo_seguimiento: dentroDe(20), seguimiento_etapa: 1
  }
];

const PISTAS = [
  {
    id: 'demo_pst_001', caso_id: 'demo_001',
    descripcion: 'La vi esperando en la parada de colectivos sobre Eusebio Ayala, sola, cerca de las 17:00.',
    fecha_hora_avistamiento: hace(44),
    latitud: -25.2931, longitud: -57.6204, direccion: 'Parada Eusebio Ayala c/ Medallistas',
    estado: 'VALIDADA', fotos: [FOTO_PISTA]
  },
  {
    id: 'demo_pst_004', caso_id: 'demo_006',
    descripcion: 'Un hombre parecido pasó caminando por la avenida principal con una mochila negra, rumbo a la terminal.',
    fecha_hora_avistamiento: hace(6),
    latitud: -22.5530, longitud: -55.7290, direccion: 'Avenida principal, cerca de la terminal',
    estado: 'VALIDADA', fotos: [FOTO_PISTA]
  },
  {
    id: 'demo_pst_002', caso_id: 'demo_003',
    descripcion: 'Una señora con la misma descripción preguntaba por una dirección en el mercado de Luque.',
    fecha_hora_avistamiento: hace(5),
    latitud: -25.2702, longitud: -57.4891, direccion: 'Mercado Municipal de Luque',
    estado: 'PENDIENTE'
  },
  {
    id: 'demo_pst_003', caso_id: 'demo_006',
    descripcion: 'Creo haberlo visto subir a una camioneta blanca en la zona del Barrio Obrero.',
    fecha_hora_avistamiento: hace(10),
    latitud: -22.5501, longitud: -55.7290, direccion: 'Barrio Obrero, Pedro Juan Caballero',
    estado: 'PENDIENTE'
  }
];

async function sembrar() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Cancelado: este script carga datos ficticios y no debe correr en producción.');
    process.exitCode = 1;
    return;
  }

  const db = createDatabase();
  try {
    // Cuenta ciudadana de demostración.
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const { rows: [usuario] } = await db.query(
      `INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
       VALUES ($1, $2, $3, 'ciudadano', TRUE, TRUE, CURRENT_TIMESTAMP)
       ON CONFLICT (correo) DO UPDATE
         SET nombre_completo = EXCLUDED.nombre_completo,
             contrasena_hash = EXCLUDED.contrasena_hash,
             verificado = TRUE,
             acepto_terminos = TRUE
       RETURNING id`,
      ['Ana Ejemplo', DEMO_EMAIL, hash]
    );

    // Limpieza de lo sembrado antes, respetando las claves foráneas.
    await db.query("DELETE FROM notificaciones WHERE caso_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM pistas WHERE id LIKE 'demo\\_%'");
    await db.query("DELETE FROM cambios_estado_pista WHERE pista_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM cambios_estado_caso WHERE caso_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM suscripciones_caso WHERE caso_id LIKE 'demo\\_%'");
    await db.query("DELETE FROM casos WHERE id LIKE 'demo\\_%'");

    for (const c of CASOS) {
      await db.query(
        `INSERT INTO casos (
           id, nombre_completo, edad, sexo, ciudad, departamento,
           descripcion_fisica, vestimenta, senas_particulares,
           fecha_hora_desaparicion, latitud, longitud, direccion,
           numero_denuncia, estado, reportado_por_usr_id, localizado_en,
           proximo_seguimiento, seguimiento_etapa, motivo_cierre,
           reportante_mayor_edad, autorizacion_parental, aviso_privacidad_aceptado,
           checklist_denuncia, checklist_coherencia, checklist_duplicados, checklist_menores,
           foto, creado_en, declaracion_aceptada_en, declaracion_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                   TRUE, $21, TRUE, $22, $22, $22, $22,
                   $23, $25, $25, $24)`,
        [
          c.id, c.nombre_completo, c.edad, c.sexo, c.ciudad, c.departamento,
          c.descripcion_fisica, c.vestimenta, c.senas_particulares,
          c.fecha_hora_desaparicion, c.latitud, c.longitud, c.direccion,
          c.numero_denuncia, c.estado, usuario.id, c.localizado_en ?? null,
          c.proximo_seguimiento, c.seguimiento_etapa, c.motivo_cierre ?? null,
          c.edad < 18, c.estado !== 'PENDIENTE',
          c.foto ?? '', DECLARACION_VERSION,
          // Cargado una hora después de la desaparición (orden del listado).
          new Date(c.fecha_hora_desaparicion.getTime() + 3600 * 1000)
        ]
      );
    }

    for (const p of PISTAS) {
      await db.query(
        `INSERT INTO pistas (id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento,
                             latitud, longitud, direccion, estado, fecha_envio, fotos)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_TIMESTAMP, $10)`,
        [p.id, p.caso_id, usuario.id, p.descripcion, p.fecha_hora_avistamiento,
         p.latitud, p.longitud, p.direccion, p.estado, p.fotos ?? []]
      );
    }

    await db.query(
      `INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, leida)
       VALUES ($1, 'demo_001', 'Seguimiento pendiente',
               'El caso de Sofía Montserrat Giménez pasó a seguimiento por falta de respuesta.',
               'SEGUIMIENTO_VENCIDO', FALSE),
              ($1, 'demo_008', 'Consulta de seguimiento',
               '¿La búsqueda de Nilda Raquel Sosa continúa activa? Responda dentro de las próximas 24 horas.',
               'SEGUIMIENTO', FALSE),
              ($1, 'demo_006', 'Nueva pista para tu caso',
               'Llegó una pista sobre tu caso. La administración la revisa antes de publicarla.',
               'PISTA_RECIBIDA_REPORTANTE', FALSE),
              ($1, 'demo_004', 'Caso resuelto',
               'El caso de Mateo Villalba Ortiz fue resuelto: la persona fue localizada.',
               'CASO_LOCALIZADO', TRUE),
              ($1, 'demo_003', 'Reporte aprobado',
               'El reporte de Rosa Elena Cabral fue aprobado y publicado.',
               'CASO_VALIDADO', TRUE)`,
      [usuario.id]
    );

    const { rows: [conteo] } = await db.query(
      `SELECT (SELECT COUNT(*) FROM casos WHERE id LIKE 'demo\\_%') AS casos,
              (SELECT COUNT(*) FROM pistas WHERE id LIKE 'demo\\_%') AS pistas`
    );
    console.log(`Datos de demostración cargados: ${conteo.casos} casos, ${conteo.pistas} pistas.`);
    console.log(`Cuenta ciudadana de prueba: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.log('Todos los registros son ficticios. Volvé a correr el script para regenerarlos.');
  } catch (error) {
    console.error('No se pudieron cargar los datos de demostración:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

sembrar();
