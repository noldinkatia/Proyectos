-- Antecedentes de reporte falso o abusivo: solo para la administración
-- (backend/admin-routes.js). Tabla aparte a propósito: el inicio de sesión,
-- /auth/me y el resto de las rutas del ciudadano leen "usuarios" y nunca la unen,
-- así la marca no puede filtrarse en sus respuestas.
--   motivo, registrado_por, registrado_en: quién la marcó, por qué y cuándo
--   retirado_en, retirado_por, motivo_retiro: quién la retiró, por qué y cuándo
-- Retirar no borra: queda el historial (y la auditoría del panel lo muestra).
-- No bloquea nada: solo avisa al revisar los reportes de esa persona.
CREATE TABLE IF NOT EXISTS antecedentes_usuario (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL CHECK (length(btrim(motivo)) > 0),
  registrado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retirado_en TIMESTAMPTZ,
  retirado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_retiro TEXT,
  -- Activa (sin datos de retiro) o retirada con fecha y motivo.
  CHECK (
    (retirado_en IS NULL AND retirado_por IS NULL AND motivo_retiro IS NULL)
    OR (retirado_en IS NOT NULL AND motivo_retiro IS NOT NULL AND length(btrim(motivo_retiro)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_antecedentes_activos
  ON antecedentes_usuario (usuario_id)
  WHERE retirado_en IS NULL;
