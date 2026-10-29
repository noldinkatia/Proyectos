# Inventario de la base de datos

Esquema que resulta de aplicar las migraciones `001_esquema_inicial.sql` a `008_antecedentes_usuario.sql` (`backend/migrations/`) sobre una base PostgreSQL 16 vacía. Solo estructura: no incluye datos.

Archivos relacionados:

- `rastreo_py_esquema.sql`: volcado del esquema (`pg_dump --schema-only --no-owner --no-privileges`).
- `esquema.json`: el mismo esquema en formato legible por programas.
- `cambios-desde-003.md`: lo que agregan las migraciones 004 a 008 respecto de 001 a 003.

## Resumen

| Tabla | Columnas | Índices | Claves foráneas | Creada en |
|---|---:|---:|---:|---|
| [`alertas_zona`](#alertas_zona) | 5 | 1 | 1 | `002_geocerca_alertas.sql` |
| [`antecedentes_usuario`](#antecedentes_usuario) | 8 | 2 | 3 | `008_antecedentes_usuario.sql` |
| [`cambios_estado_caso`](#cambios_estado_caso) | 6 | 2 | 2 | `001_esquema_inicial.sql` |
| [`cambios_estado_pista`](#cambios_estado_pista) | 7 | 1 | 2 | `001_esquema_inicial.sql` |
| [`casos`](#casos) | 37 | 6 | 1 | `001_esquema_inicial.sql` |
| [`codigos_verificacion`](#codigos_verificacion) | 11 | 2 | 0 | `001_esquema_inicial.sql` |
| [`notificaciones`](#notificaciones) | 11 | 3 | 2 | `001_esquema_inicial.sql` |
| [`pistas`](#pistas) | 11 | 2 | 2 | `001_esquema_inicial.sql` |
| [`schema_migrations`](#schema_migrations) | 3 | 1 | 0 | `backend/db.js (initializeDatabase)` |
| [`solicitudes_codigo`](#solicitudes_codigo) | 4 | 2 | 0 | `001_esquema_inicial.sql` |
| [`suscripciones_caso`](#suscripciones_caso) | 2 | 1 | 2 | `001_esquema_inicial.sql` |
| [`suscripciones_push`](#suscripciones_push) | 7 | 3 | 1 | `003_suscripciones_push.sql` |
| [`usuarios`](#usuarios) | 11 | 2 | 0 | `001_esquema_inicial.sql` |

No hay vistas, funciones, disparadores, tipos enumerados ni extensiones propias.

## alertas_zona

Creada en `002_geocerca_alertas.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `usuario_id` | integer | no |  |
| `latitud` | double precision | no |  |
| `longitud` | double precision | no |  |
| `consentimiento_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `actualizada_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `alertas_zona_usuario_id_fkey` (FOREIGN KEY): `FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE`
- `alertas_zona_pkey` (PRIMARY KEY): `PRIMARY KEY (usuario_id)`

Índices:

- `alertas_zona_pkey`: `UNIQUE btree (usuario_id)`

## antecedentes_usuario

Creada en `008_antecedentes_usuario.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no | `nextval('antecedentes_usuario_id_seq'::regclass)` |
| `usuario_id` | integer | no |  |
| `motivo` | text | no |  |
| `registrado_por` | integer | sí |  |
| `registrado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `retirado_en` | timestamp with time zone | sí |  |
| `retirado_por` | integer | sí |  |
| `motivo_retiro` | text | sí |  |

Restricciones:

- `antecedentes_usuario_check` (CHECK): `CHECK ((((retirado_en IS NULL) AND (retirado_por IS NULL) AND (motivo_retiro IS NULL)) OR ((retirado_en IS NOT NULL) AND (motivo_retiro IS NOT NULL) AND (length(btrim(motivo_retiro)) > 0))))`
- `antecedentes_usuario_motivo_check` (CHECK): `CHECK ((length(btrim(motivo)) > 0))`
- `antecedentes_usuario_registrado_por_fkey` (FOREIGN KEY): `FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL`
- `antecedentes_usuario_retirado_por_fkey` (FOREIGN KEY): `FOREIGN KEY (retirado_por) REFERENCES usuarios(id) ON DELETE SET NULL`
- `antecedentes_usuario_usuario_id_fkey` (FOREIGN KEY): `FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE`
- `antecedentes_usuario_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `antecedentes_usuario_pkey`: `UNIQUE btree (id)`
- `idx_antecedentes_activos`: `btree (usuario_id) WHERE (retirado_en IS NULL)`

## cambios_estado_caso

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no | `nextval('cambios_estado_caso_id_seq'::regclass)` |
| `caso_id` | text | no |  |
| `estado_anterior` | text | sí |  |
| `estado_nuevo` | text | no |  |
| `cambiado_por` | integer | sí |  |
| `cambiado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `cambios_estado_caso_cambiado_por_fkey` (FOREIGN KEY): `FOREIGN KEY (cambiado_por) REFERENCES usuarios(id)`
- `cambios_estado_caso_caso_id_fkey` (FOREIGN KEY): `FOREIGN KEY (caso_id) REFERENCES casos(id)`
- `cambios_estado_caso_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `cambios_estado_caso_pkey`: `UNIQUE btree (id)`
- `idx_cambios_estado_caso`: `btree (caso_id, cambiado_en)`

## cambios_estado_pista

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no | `nextval('cambios_estado_pista_id_seq'::regclass)` |
| `pista_id` | text | no |  |
| `estado_anterior` | text | sí |  |
| `estado_nuevo` | text | no |  |
| `motivo` | text | sí |  |
| `cambiado_por` | integer | sí |  |
| `cambiado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `cambios_estado_pista_cambiado_por_fkey` (FOREIGN KEY): `FOREIGN KEY (cambiado_por) REFERENCES usuarios(id)`
- `cambios_estado_pista_pista_id_fkey` (FOREIGN KEY): `FOREIGN KEY (pista_id) REFERENCES pistas(id)`
- `cambios_estado_pista_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `cambios_estado_pista_pkey`: `UNIQUE btree (id)`

## casos

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | text | no |  |
| `nombre_completo` | text | no |  |
| `edad` | integer | no |  |
| `sexo` | text | no |  |
| `ciudad` | text | no |  |
| `departamento` | text | no | `''::text` |
| `descripcion_fisica` | text | no |  |
| `vestimenta` | text | no |  |
| `senas_particulares` | text | no | `''::text` |
| `fecha_hora_desaparicion` | timestamp with time zone | no |  |
| `foto` | text | no | `''::text` |
| `latitud` | double precision | no |  |
| `longitud` | double precision | no |  |
| `direccion` | text | no | `''::text` |
| `numero_denuncia` | text | no | `''::text` |
| `estado` | text | no | `'PENDIENTE'::text` |
| `motivo_rechazo` | text | sí |  |
| `reportado_por_usr_id` | integer | sí |  |
| `localizado_en` | timestamp with time zone | sí |  |
| `creado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `proximo_seguimiento` | timestamp with time zone | sí |  |
| `reportante_mayor_edad` | boolean | no | `false` |
| `autorizacion_parental` | boolean | no | `false` |
| `aviso_privacidad_aceptado` | boolean | no | `false` |
| `checklist_denuncia` | boolean | no | `false` |
| `checklist_coherencia` | boolean | no | `false` |
| `checklist_duplicados` | boolean | no | `false` |
| `checklist_menores` | boolean | no | `false` |
| `motivo_cierre` | text | sí |  |
| `seguimiento_etapa` | smallint | no | `0` |
| `barrio` | text | no | `''::text` |
| `geocerca_activa` | boolean | no | `true` |
| `alerta_temprana_en` | timestamp with time zone | sí |  |
| `alerta_campos` | jsonb | no | `'["departamento", "ciudad", "barrio"]'::jsonb` |
| `seguimiento_intentos` | smallint | no | `0` |
| `declaracion_aceptada_en` | timestamp with time zone | sí |  |
| `declaracion_version` | text | sí |  |

Restricciones:

- `casos_seguimiento_intentos_check` (CHECK): `CHECK (((seguimiento_intentos >= 0) AND (seguimiento_intentos <= 2)))`
- `casos_reportado_por_usr_id_fkey` (FOREIGN KEY): `FOREIGN KEY (reportado_por_usr_id) REFERENCES usuarios(id)`
- `casos_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `casos_pkey`: `UNIQUE btree (id)`
- `idx_casos_creado_en`: `btree (creado_en)`
- `idx_casos_estado_localizado`: `btree (estado, localizado_en)`
- `idx_casos_localizados`: `btree (estado, localizado_en) WHERE (localizado_en IS NOT NULL)`
- `idx_casos_reportante_alerta`: `btree (reportado_por_usr_id, alerta_temprana_en) WHERE (alerta_temprana_en IS NOT NULL)`
- `idx_casos_seguimiento_due`: `btree (proximo_seguimiento) WHERE (proximo_seguimiento IS NOT NULL)`

## codigos_verificacion

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | integer | no | `nextval('codigos_verificacion_id_seq'::regclass)` |
| `correo` | text | no |  |
| `codigo_hash` | text | no |  |
| `proposito` | text | no |  |
| `nombre_completo` | text | sí |  |
| `contrasena_hash` | text | sí |  |
| `acepto_terminos` | boolean | no | `false` |
| `fecha_aceptacion_terminos` | timestamp with time zone | sí |  |
| `expira_en` | timestamp with time zone | no |  |
| `intentos` | integer | no | `0` |
| `creado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `codigos_verificacion_proposito_check` (CHECK): `CHECK ((proposito = ANY (ARRAY['registro'::text, 'restablecer'::text])))`
- `codigos_verificacion_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`
- `codigos_verificacion_correo_proposito_key` (UNIQUE): `UNIQUE (correo, proposito)`

Índices:

- `codigos_verificacion_correo_proposito_key`: `UNIQUE btree (correo, proposito)`
- `codigos_verificacion_pkey`: `UNIQUE btree (id)`

## notificaciones

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no | `nextval('notificaciones_id_seq'::regclass)` |
| `usuario_id` | integer | no |  |
| `caso_id` | text | sí |  |
| `titulo` | text | no |  |
| `mensaje` | text | no |  |
| `tipo` | text | no |  |
| `leida` | boolean | no | `false` |
| `creada_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `distancia_km` | numeric(6,1) | sí |  |
| `canal` | text | no | `'app'::text` |
| `push_resultado` | text | sí |  |

Restricciones:

- `notificaciones_canal_check` (CHECK): `CHECK ((canal = ANY (ARRAY['app'::text, 'push'::text])))`
- `notificaciones_push_resultado_check` (CHECK): `CHECK ((push_resultado = ANY (ARRAY['enviado'::text, 'fallido'::text, 'caducado'::text, 'sin_dispositivo'::text])))`
- `notificaciones_caso_id_fkey` (FOREIGN KEY): `FOREIGN KEY (caso_id) REFERENCES casos(id)`
- `notificaciones_usuario_id_fkey` (FOREIGN KEY): `FOREIGN KEY (usuario_id) REFERENCES usuarios(id)`
- `notificaciones_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `idx_notificaciones_caso_tipo`: `btree (caso_id, tipo)`
- `notificaciones_pkey`: `UNIQUE btree (id)`
- `uq_notificaciones_alerta_zona`: `UNIQUE btree (usuario_id, caso_id, tipo) WHERE (tipo = ANY (ARRAY['ALERTA_TEMPRANA'::text, 'ALERTA_OFICIAL'::text, 'ALERTA_RETRACTADA'::text, 'ALERTA_LOCALIZADO'::text, 'ALERTA_CERRADO'::text]))`

## pistas

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | text | no |  |
| `caso_id` | text | no |  |
| `usuario_id` | integer | sí |  |
| `descripcion` | text | no |  |
| `fecha_hora_avistamiento` | timestamp with time zone | no |  |
| `latitud` | double precision | no |  |
| `longitud` | double precision | no |  |
| `direccion` | text | no | `''::text` |
| `fotos` | text[] | no | `'{}'::text[]` |
| `estado` | text | no | `'PENDIENTE'::text` |
| `fecha_envio` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `pistas_caso_id_fkey` (FOREIGN KEY): `FOREIGN KEY (caso_id) REFERENCES casos(id)`
- `pistas_usuario_id_fkey` (FOREIGN KEY): `FOREIGN KEY (usuario_id) REFERENCES usuarios(id)`
- `pistas_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `idx_pistas_caso`: `btree (caso_id, fecha_envio)`
- `pistas_pkey`: `UNIQUE btree (id)`

## schema_migrations

Creada en `backend/db.js (initializeDatabase)`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `version` | text | no |  |
| `archivo` | text | no |  |
| `aplicada_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `schema_migrations_pkey` (PRIMARY KEY): `PRIMARY KEY (version)`

Índices:

- `schema_migrations_pkey`: `UNIQUE btree (version)`

## solicitudes_codigo

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | integer | no | `nextval('solicitudes_codigo_id_seq'::regclass)` |
| `correo` | text | no |  |
| `proposito` | text | no |  |
| `creado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |

Restricciones:

- `solicitudes_codigo_proposito_check` (CHECK): `CHECK ((proposito = ANY (ARRAY['registro'::text, 'restablecer'::text])))`
- `solicitudes_codigo_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`

Índices:

- `idx_solicitudes_correo_fecha`: `btree (correo, creado_en)`
- `solicitudes_codigo_pkey`: `UNIQUE btree (id)`

## suscripciones_caso

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `caso_id` | text | no |  |
| `usuario_id` | integer | no |  |

Restricciones:

- `suscripciones_caso_caso_id_fkey` (FOREIGN KEY): `FOREIGN KEY (caso_id) REFERENCES casos(id)`
- `suscripciones_caso_usuario_id_fkey` (FOREIGN KEY): `FOREIGN KEY (usuario_id) REFERENCES usuarios(id)`
- `suscripciones_caso_pkey` (PRIMARY KEY): `PRIMARY KEY (caso_id, usuario_id)`

Índices:

- `suscripciones_caso_pkey`: `UNIQUE btree (caso_id, usuario_id)`

## suscripciones_push

Creada en `003_suscripciones_push.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no | `nextval('suscripciones_push_id_seq'::regclass)` |
| `usuario_id` | integer | no |  |
| `endpoint` | text | no |  |
| `p256dh` | text | no |  |
| `auth` | text | no |  |
| `creada_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `ultimo_error_en` | timestamp with time zone | sí |  |

Restricciones:

- `suscripciones_push_usuario_id_fkey` (FOREIGN KEY): `FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE`
- `suscripciones_push_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`
- `suscripciones_push_endpoint_key` (UNIQUE): `UNIQUE (endpoint)`

Índices:

- `idx_suscripciones_push_usuario`: `btree (usuario_id)`
- `suscripciones_push_endpoint_key`: `UNIQUE btree (endpoint)`
- `suscripciones_push_pkey`: `UNIQUE btree (id)`

## usuarios

Creada en `001_esquema_inicial.sql`.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | integer | no | `nextval('usuarios_id_seq'::regclass)` |
| `nombre_completo` | text | no |  |
| `correo` | text | no |  |
| `contrasena_hash` | text | no |  |
| `rol` | text | no | `'ciudadano'::text` |
| `verificado` | boolean | no | `false` |
| `acepto_terminos` | boolean | no | `false` |
| `fecha_aceptacion_terminos` | timestamp with time zone | sí |  |
| `creado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `actualizado_en` | timestamp with time zone | no | `CURRENT_TIMESTAMP` |
| `sesion_version` | integer | no | `0` |

Restricciones:

- `usuarios_rol_check` (CHECK): `CHECK ((rol = ANY (ARRAY['ciudadano'::text, 'administrador'::text])))`
- `usuarios_pkey` (PRIMARY KEY): `PRIMARY KEY (id)`
- `usuarios_correo_key` (UNIQUE): `UNIQUE (correo)`

Índices:

- `usuarios_correo_key`: `UNIQUE btree (correo)`
- `usuarios_pkey`: `UNIQUE btree (id)`
