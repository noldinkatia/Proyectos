-- Datos que el reportante eligió mostrar en la alerta temprana (lista permitida en
-- public/js/alerta-campos.js). Solo vale para la alerta temprana: al validarse, el
-- caso se publica como siempre. Los casos anteriores quedan con los de por defecto.
ALTER TABLE casos ADD COLUMN IF NOT EXISTS alerta_campos JSONB NOT NULL
  DEFAULT '["departamento", "ciudad", "barrio"]'::jsonb;
