-- Edición del reporte por quien lo hizo, solo mientras está PENDIENTE
-- (PUT /api/mis-casos/:id en backend/case-routes.js).
--   casos.modificado_en: última edición del reportante (NULL si nunca editó)
--   casos.ediciones_reportante: cuántas veces lo editó (tope en el servidor)
-- Cada edición queda en ediciones_caso con los campos que cambiaron (valor
-- anterior y nuevo; de la foto solo si se agregó, reemplazó o quitó, nunca su
-- contenido) y la declaración de responsabilidad que se volvió a aceptar: la
-- versión y la hora del servidor. casos.declaracion_aceptada_en conserva la
-- aceptación original. El historial se conserva aunque el caso se valide o rechace.
ALTER TABLE casos ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMPTZ;
ALTER TABLE casos ADD COLUMN IF NOT EXISTS ediciones_reportante INTEGER NOT NULL DEFAULT 0
  CHECK (ediciones_reportante >= 0);

CREATE TABLE IF NOT EXISTS ediciones_caso (
  id BIGSERIAL PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  editado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cambios JSONB NOT NULL CHECK (jsonb_typeof(cambios) = 'array' AND jsonb_array_length(cambios) > 0),
  declaracion_version TEXT NOT NULL,
  declaracion_aceptada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ediciones_caso ON ediciones_caso (caso_id, editado_en);
