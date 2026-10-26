-- Seguimiento en dos intentos (backend/followups.js): cuántas preguntas de la
-- consulta en curso se enviaron sin respuesta.
--   0 = ninguna (el caso espera las 48 h)
--   1 = primera pregunta enviada, se espera respuesta 24 h
--   2 = segunda pregunta enviada, se espera respuesta 24 h más; sin respuesta,
--       el caso pasa a "Sin actualizar" (seguimiento_etapa = 2) y se avisa a la
--       administración
-- seguimiento_etapa conserva su significado (0 espera, 1 consultado, 2 sin
-- actualizar o terminado); este contador solo distingue el primer intento del
-- segundo. Cualquier respuesta del reportante lo vuelve a 0.
ALTER TABLE casos ADD COLUMN IF NOT EXISTS seguimiento_intentos SMALLINT NOT NULL DEFAULT 0
  CHECK (seguimiento_intentos BETWEEN 0 AND 2);

-- Casos que ya estaban esperando la respuesta a la primera pregunta: siguen con
-- la segunda en vez de pasar directo a "Sin actualizar".
UPDATE casos SET seguimiento_intentos = 1
WHERE seguimiento_etapa = 1 AND seguimiento_intentos = 0
  AND estado IN ('VALIDADO', 'EN_SEGUIMIENTO');
