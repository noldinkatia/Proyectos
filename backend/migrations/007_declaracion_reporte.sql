-- Declaración de responsabilidad al publicar un reporte (public/js/declaracion.js):
--   declaracion_aceptada_en: cuándo la aceptó quien reportó (hora del servidor al
--     crear el caso, no la del navegador)
--   declaracion_version: qué versión del texto aceptó (DECLARACION_VERSION)
-- Los casos anteriores quedan en NULL: se crearon antes de que existiera.
ALTER TABLE casos ADD COLUMN IF NOT EXISTS declaracion_aceptada_en TIMESTAMPTZ;
ALTER TABLE casos ADD COLUMN IF NOT EXISTS declaracion_version TEXT;
