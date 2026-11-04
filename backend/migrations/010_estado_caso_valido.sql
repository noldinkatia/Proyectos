-- casos.estado solo admite los seis estados del caso (backend/estados-caso.js).
-- Los saltos entre estados los controla el servidor; acá se impide un valor que no
-- exista (un error de tipeo o una escritura a mano).
--
-- Segura para una base con datos (Neon): se puede correr más de una vez (si la
-- restricción ya existe no hace nada) y antes de crearla revisa las filas. Si
-- alguna tiene otro valor, se detiene con un mensaje que dice cuáles y cuántas, sin
-- cambiar nada: initializeDatabase (db.js) aplica la migración en una transacción.
DO $$
DECLARE
  invalidos TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'casos_estado_valido' AND conrelid = 'casos'::regclass
  ) THEN
    RETURN;
  END IF;

  SELECT string_agg(format('%L (%s)', estado, cantidad), ', ' ORDER BY estado) INTO invalidos
  FROM (
    SELECT estado, COUNT(*) AS cantidad FROM casos
    WHERE estado IS NULL
      OR estado NOT IN ('PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO')
    GROUP BY estado
  ) x;

  IF invalidos IS NOT NULL THEN
    RAISE EXCEPTION 'Migración 010: hay casos con un estado que no es válido: %. Corregilos (UPDATE casos SET estado = ... WHERE estado = ...) y volvé a iniciar el servidor; no se cambió nada.', invalidos;
  END IF;

  ALTER TABLE casos ADD CONSTRAINT casos_estado_valido
    CHECK (estado IN ('PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO'));
END
$$;
