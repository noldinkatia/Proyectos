-- Notificaciones Web Push: una suscripción por dispositivo (el endpoint lo da el
-- servicio push del navegador). Se borran al desactivar las alertas de zona y
-- cuando el servicio responde que caducaron (404/410).
CREATE TABLE IF NOT EXISTS suscripciones_push (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_error_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_suscripciones_push_usuario ON suscripciones_push (usuario_id);

-- Resultado del push de cada notificación con canal 'push' (auditoría).
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS push_resultado TEXT
  CHECK (push_resultado IN ('enviado', 'fallido', 'caducado', 'sin_dispositivo'));
