-- Alertas por geocerca de 160 km (documento del Workshop, sección 5.2).

-- Usuarios que activaron "Alertas de mi zona": solo la última posición, redondeada
-- a 2 decimales (≈1 km), sin historial. Desactivar borra la fila.
CREATE TABLE IF NOT EXISTS alertas_zona (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  latitud DOUBLE PRECISION NOT NULL,
  longitud DOUBLE PRECISION NOT NULL,
  consentimiento_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Auditoría de cada envío: distancia calculada y canal ('app' = solo centro de
-- notificaciones; 'push' = centro de notificaciones y además push al dispositivo).
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS distancia_km NUMERIC(6, 1);
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'app'
  CHECK (canal IN ('app', 'push'));

-- Una sola alerta de cada tipo por usuario y caso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_alerta_zona
  ON notificaciones (usuario_id, caso_id, tipo)
  WHERE tipo IN ('ALERTA_TEMPRANA', 'ALERTA_OFICIAL', 'ALERTA_RETRACTADA', 'ALERTA_LOCALIZADO', 'ALERTA_CERRADO');
CREATE INDEX IF NOT EXISTS idx_notificaciones_caso_tipo ON notificaciones (caso_id, tipo);

-- La geocerca de un caso se apaga al localizarlo, cerrarlo o rechazarlo.
ALTER TABLE casos ADD COLUMN IF NOT EXISTS geocerca_activa BOOLEAN NOT NULL DEFAULT TRUE;
-- Cuándo salió la alerta temprana (NULL: no salió, por duplicado o por el límite
-- por reportante). También sirve para ese límite.
ALTER TABLE casos ADD COLUMN IF NOT EXISTS alerta_temprana_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_casos_reportante_alerta
  ON casos (reportado_por_usr_id, alerta_temprana_en) WHERE alerta_temprana_en IS NOT NULL;
