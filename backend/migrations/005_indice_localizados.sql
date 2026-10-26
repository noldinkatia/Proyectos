-- Cierre automático de localizados (backend/followups.js, cada minuto) y
-- estadísticas de encontrados (case-shared.js, casoEncontrado): ambos buscan
-- casos con fecha de localizado, por estado y por esa fecha.
CREATE INDEX IF NOT EXISTS idx_casos_localizados
  ON casos (estado, localizado_en)
  WHERE localizado_en IS NOT NULL;
