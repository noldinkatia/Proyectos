# Cambios respecto de las migraciones 001 a 003

Comparación entre el esquema que dejan `001` a `003` y el que dejan `001` a `008`, ambos aplicados sobre bases vacías. Se compararon tablas, columnas (tipo, nulo, valor por defecto), restricciones e índices.

| Cambio | Objeto | Detalle | Migración |
|---|---|---|---|
| Tabla nueva | `antecedentes_usuario` | 8 columnas, 2 índices | `008_antecedentes_usuario.sql` |
| Columna nueva | `casos.alerta_campos` | jsonb, NOT NULL, por defecto `'["departamento", "ciudad", "barrio"]'::jsonb` | `004_alerta_campos.sql` |
| Columna nueva | `casos.seguimiento_intentos` | smallint, NOT NULL, por defecto `0` | `006_seguimiento_intentos.sql` |
| Columna nueva | `casos.declaracion_aceptada_en` | timestamp with time zone, admite nulo | `007_declaracion_reporte.sql` |
| Columna nueva | `casos.declaracion_version` | text, admite nulo | `007_declaracion_reporte.sql` |
| Restricción nueva | `casos.casos_seguimiento_intentos_check` | `CHECK (((seguimiento_intentos >= 0) AND (seguimiento_intentos <= 2)))` | `006_seguimiento_intentos.sql` |
| Índice nuevo | `casos.idx_casos_localizados` | `CREATE INDEX idx_casos_localizados ON public.casos USING btree (estado, localizado_en) WHERE (localizado_en IS NOT NULL)` | `005_indice_localizados.sql` |

No se eliminó ni se modificó ningún objeto existente: todos los cambios son agregados.

006 además actualiza datos (`seguimiento_intentos = 1` en casos que esperaban la primera respuesta); en una base vacía no tiene efecto sobre el esquema.
