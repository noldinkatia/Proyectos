--
-- PostgreSQL database dump
--

\restrict uCjZI7kBv9R4xm5HuVaeT4ORG5HQbJTc3TwVKWHIlQdzzNwzUlLka4HOuE0mSKA

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alertas_zona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alertas_zona (
    usuario_id integer NOT NULL,
    latitud double precision NOT NULL,
    longitud double precision NOT NULL,
    consentimiento_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actualizada_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: antecedentes_usuario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.antecedentes_usuario (
    id bigint NOT NULL,
    usuario_id integer NOT NULL,
    motivo text NOT NULL,
    registrado_por integer,
    registrado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    retirado_en timestamp with time zone,
    retirado_por integer,
    motivo_retiro text,
    CONSTRAINT antecedentes_usuario_check CHECK ((((retirado_en IS NULL) AND (retirado_por IS NULL) AND (motivo_retiro IS NULL)) OR ((retirado_en IS NOT NULL) AND (motivo_retiro IS NOT NULL) AND (length(btrim(motivo_retiro)) > 0)))),
    CONSTRAINT antecedentes_usuario_motivo_check CHECK ((length(btrim(motivo)) > 0))
);


--
-- Name: antecedentes_usuario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.antecedentes_usuario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: antecedentes_usuario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.antecedentes_usuario_id_seq OWNED BY public.antecedentes_usuario.id;


--
-- Name: cambios_estado_caso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cambios_estado_caso (
    id bigint NOT NULL,
    caso_id text NOT NULL,
    estado_anterior text,
    estado_nuevo text NOT NULL,
    cambiado_por integer,
    cambiado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cambios_estado_caso_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cambios_estado_caso_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cambios_estado_caso_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cambios_estado_caso_id_seq OWNED BY public.cambios_estado_caso.id;


--
-- Name: cambios_estado_pista; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cambios_estado_pista (
    id bigint NOT NULL,
    pista_id text NOT NULL,
    estado_anterior text,
    estado_nuevo text NOT NULL,
    motivo text,
    cambiado_por integer,
    cambiado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cambios_estado_pista_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cambios_estado_pista_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cambios_estado_pista_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cambios_estado_pista_id_seq OWNED BY public.cambios_estado_pista.id;


--
-- Name: casos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.casos (
    id text NOT NULL,
    nombre_completo text NOT NULL,
    edad integer NOT NULL,
    sexo text NOT NULL,
    ciudad text NOT NULL,
    departamento text DEFAULT ''::text NOT NULL,
    descripcion_fisica text NOT NULL,
    vestimenta text NOT NULL,
    senas_particulares text DEFAULT ''::text NOT NULL,
    fecha_hora_desaparicion timestamp with time zone NOT NULL,
    foto text DEFAULT ''::text NOT NULL,
    latitud double precision NOT NULL,
    longitud double precision NOT NULL,
    direccion text DEFAULT ''::text NOT NULL,
    numero_denuncia text DEFAULT ''::text NOT NULL,
    estado text DEFAULT 'PENDIENTE'::text NOT NULL,
    motivo_rechazo text,
    reportado_por_usr_id integer,
    localizado_en timestamp with time zone,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    proximo_seguimiento timestamp with time zone,
    reportante_mayor_edad boolean DEFAULT false NOT NULL,
    autorizacion_parental boolean DEFAULT false NOT NULL,
    aviso_privacidad_aceptado boolean DEFAULT false NOT NULL,
    checklist_denuncia boolean DEFAULT false NOT NULL,
    checklist_coherencia boolean DEFAULT false NOT NULL,
    checklist_duplicados boolean DEFAULT false NOT NULL,
    checklist_menores boolean DEFAULT false NOT NULL,
    motivo_cierre text,
    seguimiento_etapa smallint DEFAULT 0 NOT NULL,
    barrio text DEFAULT ''::text NOT NULL,
    geocerca_activa boolean DEFAULT true NOT NULL,
    alerta_temprana_en timestamp with time zone,
    alerta_campos jsonb DEFAULT '["departamento", "ciudad", "barrio"]'::jsonb NOT NULL,
    seguimiento_intentos smallint DEFAULT 0 NOT NULL,
    declaracion_aceptada_en timestamp with time zone,
    declaracion_version text,
    CONSTRAINT casos_seguimiento_intentos_check CHECK (((seguimiento_intentos >= 0) AND (seguimiento_intentos <= 2)))
);


--
-- Name: codigos_verificacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.codigos_verificacion (
    id integer NOT NULL,
    correo text NOT NULL,
    codigo_hash text NOT NULL,
    proposito text NOT NULL,
    nombre_completo text,
    contrasena_hash text,
    acepto_terminos boolean DEFAULT false NOT NULL,
    fecha_aceptacion_terminos timestamp with time zone,
    expira_en timestamp with time zone NOT NULL,
    intentos integer DEFAULT 0 NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT codigos_verificacion_proposito_check CHECK ((proposito = ANY (ARRAY['registro'::text, 'restablecer'::text])))
);


--
-- Name: codigos_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.codigos_verificacion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: codigos_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.codigos_verificacion_id_seq OWNED BY public.codigos_verificacion.id;


--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones (
    id bigint NOT NULL,
    usuario_id integer NOT NULL,
    caso_id text,
    titulo text NOT NULL,
    mensaje text NOT NULL,
    tipo text NOT NULL,
    leida boolean DEFAULT false NOT NULL,
    creada_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    distancia_km numeric(6,1),
    canal text DEFAULT 'app'::text NOT NULL,
    push_resultado text,
    CONSTRAINT notificaciones_canal_check CHECK ((canal = ANY (ARRAY['app'::text, 'push'::text]))),
    CONSTRAINT notificaciones_push_resultado_check CHECK ((push_resultado = ANY (ARRAY['enviado'::text, 'fallido'::text, 'caducado'::text, 'sin_dispositivo'::text])))
);


--
-- Name: notificaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notificaciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificaciones_id_seq OWNED BY public.notificaciones.id;


--
-- Name: pistas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pistas (
    id text NOT NULL,
    caso_id text NOT NULL,
    usuario_id integer,
    descripcion text NOT NULL,
    fecha_hora_avistamiento timestamp with time zone NOT NULL,
    latitud double precision NOT NULL,
    longitud double precision NOT NULL,
    direccion text DEFAULT ''::text NOT NULL,
    fotos text[] DEFAULT '{}'::text[] NOT NULL,
    estado text DEFAULT 'PENDIENTE'::text NOT NULL,
    fecha_envio timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    archivo text NOT NULL,
    aplicada_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: solicitudes_codigo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitudes_codigo (
    id integer NOT NULL,
    correo text NOT NULL,
    proposito text NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT solicitudes_codigo_proposito_check CHECK ((proposito = ANY (ARRAY['registro'::text, 'restablecer'::text])))
);


--
-- Name: solicitudes_codigo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitudes_codigo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitudes_codigo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitudes_codigo_id_seq OWNED BY public.solicitudes_codigo.id;


--
-- Name: suscripciones_caso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suscripciones_caso (
    caso_id text NOT NULL,
    usuario_id integer NOT NULL
);


--
-- Name: suscripciones_push; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suscripciones_push (
    id bigint NOT NULL,
    usuario_id integer NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    creada_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ultimo_error_en timestamp with time zone
);


--
-- Name: suscripciones_push_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suscripciones_push_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suscripciones_push_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suscripciones_push_id_seq OWNED BY public.suscripciones_push.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    nombre_completo text NOT NULL,
    correo text NOT NULL,
    contrasena_hash text NOT NULL,
    rol text DEFAULT 'ciudadano'::text NOT NULL,
    verificado boolean DEFAULT false NOT NULL,
    acepto_terminos boolean DEFAULT false NOT NULL,
    fecha_aceptacion_terminos timestamp with time zone,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actualizado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sesion_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT usuarios_rol_check CHECK ((rol = ANY (ARRAY['ciudadano'::text, 'administrador'::text])))
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: antecedentes_usuario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antecedentes_usuario ALTER COLUMN id SET DEFAULT nextval('public.antecedentes_usuario_id_seq'::regclass);


--
-- Name: cambios_estado_caso id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_caso ALTER COLUMN id SET DEFAULT nextval('public.cambios_estado_caso_id_seq'::regclass);


--
-- Name: cambios_estado_pista id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_pista ALTER COLUMN id SET DEFAULT nextval('public.cambios_estado_pista_id_seq'::regclass);


--
-- Name: codigos_verificacion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codigos_verificacion ALTER COLUMN id SET DEFAULT nextval('public.codigos_verificacion_id_seq'::regclass);


--
-- Name: notificaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones ALTER COLUMN id SET DEFAULT nextval('public.notificaciones_id_seq'::regclass);


--
-- Name: solicitudes_codigo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_codigo ALTER COLUMN id SET DEFAULT nextval('public.solicitudes_codigo_id_seq'::regclass);


--
-- Name: suscripciones_push id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_push ALTER COLUMN id SET DEFAULT nextval('public.suscripciones_push_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Name: alertas_zona alertas_zona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_zona
    ADD CONSTRAINT alertas_zona_pkey PRIMARY KEY (usuario_id);


--
-- Name: antecedentes_usuario antecedentes_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antecedentes_usuario
    ADD CONSTRAINT antecedentes_usuario_pkey PRIMARY KEY (id);


--
-- Name: cambios_estado_caso cambios_estado_caso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_caso
    ADD CONSTRAINT cambios_estado_caso_pkey PRIMARY KEY (id);


--
-- Name: cambios_estado_pista cambios_estado_pista_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_pista
    ADD CONSTRAINT cambios_estado_pista_pkey PRIMARY KEY (id);


--
-- Name: casos casos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casos
    ADD CONSTRAINT casos_pkey PRIMARY KEY (id);


--
-- Name: codigos_verificacion codigos_verificacion_correo_proposito_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codigos_verificacion
    ADD CONSTRAINT codigos_verificacion_correo_proposito_key UNIQUE (correo, proposito);


--
-- Name: codigos_verificacion codigos_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codigos_verificacion
    ADD CONSTRAINT codigos_verificacion_pkey PRIMARY KEY (id);


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: pistas pistas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pistas
    ADD CONSTRAINT pistas_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: solicitudes_codigo solicitudes_codigo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_codigo
    ADD CONSTRAINT solicitudes_codigo_pkey PRIMARY KEY (id);


--
-- Name: suscripciones_caso suscripciones_caso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_caso
    ADD CONSTRAINT suscripciones_caso_pkey PRIMARY KEY (caso_id, usuario_id);


--
-- Name: suscripciones_push suscripciones_push_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_push
    ADD CONSTRAINT suscripciones_push_endpoint_key UNIQUE (endpoint);


--
-- Name: suscripciones_push suscripciones_push_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_push
    ADD CONSTRAINT suscripciones_push_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_correo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_correo_key UNIQUE (correo);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: idx_antecedentes_activos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_antecedentes_activos ON public.antecedentes_usuario USING btree (usuario_id) WHERE (retirado_en IS NULL);


--
-- Name: idx_cambios_estado_caso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cambios_estado_caso ON public.cambios_estado_caso USING btree (caso_id, cambiado_en);


--
-- Name: idx_casos_creado_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_casos_creado_en ON public.casos USING btree (creado_en);


--
-- Name: idx_casos_estado_localizado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_casos_estado_localizado ON public.casos USING btree (estado, localizado_en);


--
-- Name: idx_casos_localizados; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_casos_localizados ON public.casos USING btree (estado, localizado_en) WHERE (localizado_en IS NOT NULL);


--
-- Name: idx_casos_reportante_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_casos_reportante_alerta ON public.casos USING btree (reportado_por_usr_id, alerta_temprana_en) WHERE (alerta_temprana_en IS NOT NULL);


--
-- Name: idx_casos_seguimiento_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_casos_seguimiento_due ON public.casos USING btree (proximo_seguimiento) WHERE (proximo_seguimiento IS NOT NULL);


--
-- Name: idx_notificaciones_caso_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_caso_tipo ON public.notificaciones USING btree (caso_id, tipo);


--
-- Name: idx_pistas_caso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pistas_caso ON public.pistas USING btree (caso_id, fecha_envio);


--
-- Name: idx_solicitudes_correo_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitudes_correo_fecha ON public.solicitudes_codigo USING btree (correo, creado_en);


--
-- Name: idx_suscripciones_push_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suscripciones_push_usuario ON public.suscripciones_push USING btree (usuario_id);


--
-- Name: uq_notificaciones_alerta_zona; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_notificaciones_alerta_zona ON public.notificaciones USING btree (usuario_id, caso_id, tipo) WHERE (tipo = ANY (ARRAY['ALERTA_TEMPRANA'::text, 'ALERTA_OFICIAL'::text, 'ALERTA_RETRACTADA'::text, 'ALERTA_LOCALIZADO'::text, 'ALERTA_CERRADO'::text]));


--
-- Name: alertas_zona alertas_zona_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_zona
    ADD CONSTRAINT alertas_zona_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: antecedentes_usuario antecedentes_usuario_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antecedentes_usuario
    ADD CONSTRAINT antecedentes_usuario_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: antecedentes_usuario antecedentes_usuario_retirado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antecedentes_usuario
    ADD CONSTRAINT antecedentes_usuario_retirado_por_fkey FOREIGN KEY (retirado_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: antecedentes_usuario antecedentes_usuario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.antecedentes_usuario
    ADD CONSTRAINT antecedentes_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: cambios_estado_caso cambios_estado_caso_cambiado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_caso
    ADD CONSTRAINT cambios_estado_caso_cambiado_por_fkey FOREIGN KEY (cambiado_por) REFERENCES public.usuarios(id);


--
-- Name: cambios_estado_caso cambios_estado_caso_caso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_caso
    ADD CONSTRAINT cambios_estado_caso_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES public.casos(id);


--
-- Name: cambios_estado_pista cambios_estado_pista_cambiado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_pista
    ADD CONSTRAINT cambios_estado_pista_cambiado_por_fkey FOREIGN KEY (cambiado_por) REFERENCES public.usuarios(id);


--
-- Name: cambios_estado_pista cambios_estado_pista_pista_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cambios_estado_pista
    ADD CONSTRAINT cambios_estado_pista_pista_id_fkey FOREIGN KEY (pista_id) REFERENCES public.pistas(id);


--
-- Name: casos casos_reportado_por_usr_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casos
    ADD CONSTRAINT casos_reportado_por_usr_id_fkey FOREIGN KEY (reportado_por_usr_id) REFERENCES public.usuarios(id);


--
-- Name: notificaciones notificaciones_caso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES public.casos(id);


--
-- Name: notificaciones notificaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: pistas pistas_caso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pistas
    ADD CONSTRAINT pistas_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES public.casos(id);


--
-- Name: pistas pistas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pistas
    ADD CONSTRAINT pistas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: suscripciones_caso suscripciones_caso_caso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_caso
    ADD CONSTRAINT suscripciones_caso_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES public.casos(id);


--
-- Name: suscripciones_caso suscripciones_caso_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_caso
    ADD CONSTRAINT suscripciones_caso_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: suscripciones_push suscripciones_push_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones_push
    ADD CONSTRAINT suscripciones_push_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict uCjZI7kBv9R4xm5HuVaeT4ORG5HQbJTc3TwVKWHIlQdzzNwzUlLka4HOuE0mSKA
