# Despliegue de Rastreo PY en Render + Neon

Esta guía sube la app a internet con dos servicios gratuitos:

- **Render** corre la app (el mismo `Dockerfile` que usamos con Docker en la notebook).
- **Neon** guarda la base de datos PostgreSQL.

El archivo `render.yaml` de la raíz del proyecto le dice a Render cómo armar el servicio.
No contiene ningún secreto: las contraseñas se cargan a mano en el panel de Render.

> Antes de empezar: leé la sección [Límites del plan gratuito](#límites-del-plan-gratuito).
> Explica por qué la app "se duerme" y cuántas horas de uso tenemos por mes.

---

## 1. Crear la base de datos en Neon

1. Entrá a <https://neon.tech> y creá una cuenta (se puede entrar con GitHub o Google).
2. Creá un proyecto nuevo (**New Project**):
   - **Name:** `rastreo-py`
   - **Postgres version:** la que venga por defecto (16 o más nueva sirve).
   - **Region:** **AWS US East 1 (N. Virginia)**. Tiene que ser esta: el servicio
     de Render está en Virginia, y si la base queda lejos, cada consulta tarda más.
3. En el panel del proyecto, tocá **Connect**.
4. Desactivá **Connection pooling** (la app es un solo proceso y ya maneja sus
   propias conexiones; la conexión directa es la más simple).
5. Copiá la cadena de conexión. Se ve así (con tus datos):

   ```
   postgresql://neondb_owner:CONTRASEÑA@ep-algo-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

   - Tiene que terminar con **`?sslmode=require`**. Si no lo tiene, agregalo al final.
   - Si Neon agrega también `&channel_binding=require`, puede quedar: no molesta.
6. Guardala en un lugar seguro (un gestor de contraseñas, **no** en un archivo del
   proyecto ni en el chat del equipo). Es la llave de toda la base de datos.

No hace falta crear tablas: la app las crea sola la primera vez que arranca.

## 2. Subir el código a GitHub

Render construye la app desde GitHub, así que la rama tiene que estar subida:

```powershell
git push origin frontend-pwa
```

Mientras `render.yaml` no esté en `main`, el Blueprint se crea apuntando a la rama
`frontend-pwa`. Cuando se haga el merge a `main`, se puede cambiar la rama en
Render (**Settings → Build & Deploy → Branch**).

## 3. Preparar los valores de las variables

Antes de ir a Render, tené a mano estos siete valores:

| Variable | Qué poner |
|---|---|
| `DATABASE_URL` | La cadena de Neon del paso 1 (con `?sslmode=require`). |
| `MAIL_USER` | La cuenta de Gmail que manda los correos (códigos, avisos). |
| `MAIL_PASS` | La **contraseña de aplicación** de esa cuenta de Gmail (16 letras), no la contraseña normal. Se crea en: Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones. |
| `JWT_SECRET` | Un texto aleatorio largo (ver abajo cómo generarlo). |
| `ADMIN_IDENTIFICADOR` | El correo de la cuenta administradora. |
| `ADMIN_PASSWORD` | Una contraseña segura para el administrador (mínimo 8 caracteres). |
| `APP_URL` | La dirección pública de la app en Render (ver paso 5). Para empezar: `https://rastreo-py.onrender.com` |

**Cómo generar `JWT_SECRET`** (en PowerShell, con Node instalado):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copiá el resultado (96 caracteres). La app exige al menos 32. Si alguna vez se
cambia este valor, todas las sesiones abiertas se cierran (hay que volver a entrar).

**Sobre `ADMIN_PASSWORD`:** solo se usa para **crear** la cuenta la primera vez. Si
después se cambia la contraseña desde la app, reiniciar Render no la pisa.

Las otras variables (`NODE_ENV`, `TRUST_PROXY_HOPS`, `LIMITE_LECTURA_PUBLICA_POR_MINUTO`,
`DATABASE_SSL`) ya vienen escritas en `render.yaml`: no hay que cargarlas.

## 4. Crear el servicio en Render desde el Blueprint

1. Entrá a <https://render.com> y creá una cuenta **con GitHub**.
2. Arriba a la derecha: **New → Blueprint**.
3. Conectá el repositorio `Proyectos` (si no aparece, tocá **Configure account** y
   dale permiso a Render para ver ese repositorio).
4. Elegí la rama `frontend-pwa`. Render encuentra `render.yaml` y muestra un servicio
   llamado `rastreo-py`.
5. Render pide los valores de las variables marcadas como secretas (`sync: false`).
   Pegá los siete valores del paso 3.
6. Tocá **Apply** (o **Deploy Blueprint**). Render construye la imagen de Docker;
   la primera vez tarda varios minutos.
7. Abrí el servicio `rastreo-py` → pestaña **Logs**. Cuando todo está bien aparece:

   ```
   Servidor Rastreo PY disponible en el puerto 10000.
   ```

   (El número de puerto lo elige Render; no importa cuál sea.)

**Un aviso que es normal en los logs:**

```
SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
```

Lo escribe la librería de PostgreSQL al ver `sslmode=require`. Significa que la
conexión con Neon está cifrada **y además** se verifica el certificado de Neon, que
es lo más seguro. No es un error. (Si molesta, se puede cambiar `sslmode=require`
por `sslmode=verify-full` en `DATABASE_URL`: hace exactamente lo mismo, sin aviso.)

**Si el log dice `No se pudo iniciar el backend: ...`**, el mensaje dice qué falta.
Los más comunes:

- `Faltan variables ...`: alguna variable quedó vacía (paso 3).
- `JWT_SECRET debe tener al menos 32 caracteres.`
- `password authentication failed`: `DATABASE_URL` mal copiada.

Las variables se corrigen en **Environment** (menú del servicio) → **Save Changes**.
Render vuelve a arrancar la app solo.

## 5. Poner la `APP_URL` correcta

1. Arriba, en la página del servicio, Render muestra su dirección, por ejemplo
   `https://rastreo-py.onrender.com` (si ese nombre ya estaba usado, Render le agrega
   letras: `https://rastreo-py-abcd.onrender.com`).
2. Si es distinta a la que pusiste, andá a **Environment**, cambiá `APP_URL` y guardá.
3. Reglas para `APP_URL`:
   - Tiene que empezar con **`https://`**.
   - **Sin** barra `/` al final.
   - Es la misma dirección que se abre en el navegador (sin `/app/`).

`APP_URL` se usa en los enlaces de los correos y para decidir qué páginas pueden
hablar con la API. Si está mal, los correos llevan a otro lado.

Para probar: abrí la dirección en el navegador. Tiene que aparecer la web de
Rastreo PY.

## 6. Cargar los datos de ejemplo en Neon (desde Windows)

El script `seed-demo.js` carga casos **ficticios** para recorrer la app. Se corre
desde tu computadora, apuntando a Neon.

**Importante:**

- Hacelo **después** del paso 4: las tablas las crea la app al arrancar.
- El script **se niega a correr con `NODE_ENV=production`**, a propósito, para que
  nadie cargue datos falsos en una base real por error. Eso no se cambia. Por eso,
  **solo en este comando**, le decimos `NODE_ENV=development`.

En PowerShell, desde la carpeta del proyecto:

```powershell
cd backend
npm ci

$env:NODE_ENV = "development"
$env:DATABASE_SSL = "true"
$env:DATABASE_URL = "PEGÁ_ACÁ_LA_CADENA_DE_NEON"
npm run seed:demo

Remove-Item Env:NODE_ENV, Env:DATABASE_SSL, Env:DATABASE_URL
```

- La última línea **borra** esas variables de la ventana de PowerShell. En
  PowerShell, una variable puesta con `$env:` dura hasta que se cierra la ventana; si
  no la borrás, el próximo comando que corras ahí también apunta a Neon.
- Si tenés un archivo `backend/.env` (para Docker local), no importa: las variables
  escritas en PowerShell ganan sobre las del archivo.
- Si sale bien, dice: `Datos de demostración cargados: 6 casos, 3 pistas.`
- Se puede correr de nuevo: borra los datos de ejemplo anteriores y los vuelve a
  crear, sin tocar los datos reales.

El script también crea una cuenta ciudadana de prueba con contraseña **pública**
(`ciudadano.demo@rastreopy.test`, la contraseña está en `backend/seed-demo.js`).
En una URL pública cualquiera puede entrar con ella. Es una cuenta común (no
administradora), pero conviene saberlo.

**Restablecer la contraseña del administrador:** el plan gratuito de Render no da
consola, así que se hace igual que lo anterior, desde Windows:

```powershell
$env:DATABASE_SSL = "true"
$env:DATABASE_URL = "PEGÁ_ACÁ_LA_CADENA_DE_NEON"
$env:ADMIN_IDENTIFICADOR = "correo-del-admin@gmail.com"
$env:ADMIN_PASSWORD = "la-nueva-contraseña"
node crear-admin.js

Remove-Item Env:DATABASE_SSL, Env:DATABASE_URL, Env:ADMIN_IDENTIFICADOR, Env:ADMIN_PASSWORD
```

## 7. Verificar la red con `/api/admin/diagnostico-red`

La app limita cuántas veces por minuto se puede usar cada función **por IP**. Detrás
de Render, la app tiene que ver la IP real de cada persona, no la del proxy de
Render. Esto se comprueba así:

1. Abrí la `APP_URL` en una computadora e **iniciá sesión como administrador**.
2. Apretá **F12** → pestaña **Console** (Consola).
3. Pegá esta línea y apretá Enter:

   ```js
   fetch('/api/admin/diagnostico-red', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('rastreo_token') } }).then(r => r.json()).then(console.log)
   ```

   (Si abrís `/api/admin/diagnostico-red` directo en la barra de direcciones responde
   "Debe iniciar sesión": la sesión viaja en un encabezado, no en una cookie.)

4. Mirá la respuesta:

   | Campo | Tiene que ser |
   |---|---|
   | `ip` | Tu IP pública. Compará con <https://www.cualesmiip.com>. |
   | `protocolo` | `https` |
   | `trustProxyHops` | `1` |

5. Si `ip` **no** es la tuya:
   - Si es una IP interna (empieza con `10.`, `172.` o `192.168.`) o la de un proxy,
     faltan saltos: en **Environment** subí `TRUST_PROXY_HOPS` a `2`, guardá y repetí.
   - Si `ip` cambia cuando alguien manda un encabezado `X-Forwarded-For` inventado,
     sobran saltos: bajá el número.

   Si cambiás `TRUST_PROXY_HOPS` en el panel, anotalo también en `render.yaml` para
   que la próxima vez se cree igual.

## 8. Probar la instalación en un celular real

La app instalable vive en **`APP_URL/app/`** (por ejemplo
`https://rastreo-py.onrender.com/app/`). Instalar una app web **solo funciona por
HTTPS**; Render ya lo da.

**Android (Chrome):**

1. Abrí `https://…onrender.com/app/` en Chrome.
2. Debería aparecer la bienvenida de instalación de Rastreo PY. Si no, tocá el menú
   **⋮** → **Instalar app** (o **Agregar a la pantalla principal**).
3. Abrí la app desde el ícono nuevo: tiene que abrirse a pantalla completa, sin la
   barra del navegador.

**iPhone (Safari):**

1. Abrí `https://…onrender.com/app/` en **Safari**.
2. Tocá el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elegí **Agregar a inicio** → **Agregar**.
4. Abrí la app desde el ícono nuevo.

**Qué revisar en los dos:** que el ícono sea el de Rastreo PY, que se pueda iniciar
sesión, ver el mapa y los casos, y que al poner el celular en modo avión la app
muestre la pantalla sin conexión en vez de un error del navegador.

Para el Workshop, el código QR tiene que apuntar a `APP_URL/app/`.

## 9. Cómo se actualiza después

Con `autoDeploy` activado, **cada `git push` a la rama del Blueprint publica sola
la versión nueva**:

```powershell
git push origin frontend-pwa
```

En **Events** se ve el avance. Mientras se construye, la versión anterior sigue
funcionando; Render cambia a la nueva recién cuando arrancó bien. Las tablas nuevas
(migraciones en `backend/migrations/`) se aplican solas al arrancar.

Si se cambia algo en `render.yaml` (por ejemplo una variable con valor fijo), Render
lo aplica al sincronizar el Blueprint (**Blueprints → rastreo-py → Sync**). Los
valores secretos cargados en el panel no se pierden.

## 10. Evitar que Render esté dormido al empezar el Workshop

En el plan gratuito, Render **apaga la app a los 15 minutos sin visitas** y la
primera visita después tarda **alrededor de 1 minuto** en despertarla. Si eso pasa
justo cuando 30 personas escanean el QR, todos ven una pantalla de carga.

**Opción A — despertarla a mano (alcanza casi siempre):**

1. **10 minutos antes** de empezar, abrí la `APP_URL` en el navegador.
2. Esperá a que cargue la web (hasta 1 minuto).
3. Con gente usándola no se vuelve a dormir (cualquier visita reinicia los 15 minutos).

**Opción B — un "ping" externo gratuito**, para que no se duerma durante todo el
evento (por ejemplo si hay pausas largas):

1. Creá una cuenta gratuita en <https://uptimerobot.com> (o <https://cron-job.org>).
2. Nuevo monitor de tipo **HTTP(s)** con la `APP_URL` (la página principal `/`) y
   un intervalo de **5 minutos** (menos de 15).
3. **Activalo la mañana del Workshop y pausalo al terminar.** No lo dejes prendido
   todo el mes, por dos motivos:
   - **Render:** el plan gratuito da **750 horas por mes** de app encendida, para
     todos los servicios gratuitos de la cuenta juntos. Un mes de 31 días tiene 744
     horas: un solo servicio despierto todo el mes entra justo, sin margen para nada más.
   - **Neon (el más importante):** la app revisa los seguimientos de casos en la
     base **cada 60 segundos** mientras está despierta. O sea: si Render no duerme,
     Neon tampoco. Con el cómputo mínimo (0,25 CU), eso son 6 CU-h por día, y el
     plan gratuito trae 100 CU-h por mes: **se agotaría en unos 16 días**.
     Cuando Render duerme, la app no consulta nada y Neon también se suspende.

---

## Límites del plan gratuito

| Servicio | Límite | Qué significa para nosotros |
|---|---|---|
| Render | Se duerme a los **15 minutos** sin visitas. | La siguiente visita tarda **~1 minuto** en despertarla (ver paso 10). |
| Render | **750 horas por mes** de app encendida (sumando todos los servicios gratuitos de la cuenta). | Alcanza para un servicio encendido todo el mes, sin margen. |
| Neon | Se suspende a los **5 minutos** sin consultas. | Despertar tarda poco (menos de un segundo, en general); no se nota como el de Render. |
| Neon | **100 CU-h por mes** de cómputo. | Se gastan mientras la base está despierta. Con nuestra app, la base está despierta mientras Render lo está (paso 10). |
| Neon | **5 GB por mes** de transferencia de datos. | Las fotos de casos y pistas se guardan en la base: cada vez que alguien abre una, sale de Neon. Con fotos livianas alcanza de sobra para un evento. |

Ver el consumo:

- **Render:** **Billing** (arriba a la derecha) → horas de instancia usadas.
- **Neon:** página del proyecto → **Usage** (cómputo y transferencia del mes).

---

## Plan B: Docker en la notebook + túnel de Cloudflare

Si Render o Neon fallan el día del Workshop, se puede servir la app **desde una
notebook** y publicarla por HTTPS con un túnel gratuito de Cloudflare (sin cuenta).

**Antes (con internet, el día anterior):**

1. Instalá Docker Desktop y levantá el proyecto como dice `INSTRUCCIONES_DOCKER.txt`
   (`docker compose up -d --build`). Comprobá que abre en <http://localhost:3000>.
2. Instalá `cloudflared` en PowerShell:

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

   (Cerrá y volvé a abrir PowerShell para que reconozca el comando.)

**El día del Workshop:**

1. Abrí Docker Desktop y levantá la app:

   ```powershell
   docker compose up -d
   ```

2. Abrí el túnel (dejá esta ventana **abierta** todo el evento):

   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

3. En lo que imprime, buscá una dirección como
   `https://palabras-al-azar.trycloudflare.com`. Esa es la URL pública.
4. Poné esa dirección en `APP_URL` dentro de `backend/.env` (con `https://`, sin `/`
   al final) y reiniciá la app para que la tome:

   ```powershell
   docker compose up -d --force-recreate web
   ```

5. Generá el QR con `https://palabras-al-azar.trycloudflare.com/app/`.
6. Verificá la IP con `/api/admin/diagnostico-red` igual que en el paso 7.
7. Datos de ejemplo (opcional), con `NODE_ENV=development` solo en ese comando:

   ```powershell
   docker compose exec -e NODE_ENV=development web node backend/seed-demo.js
   ```

**Tener en cuenta:**

- **La URL cambia cada vez que se ejecuta `cloudflared`.** Si se corta y se vuelve a
  abrir, hay una dirección nueva: hay que actualizar `APP_URL`, reiniciar la app y
  **hacer un QR nuevo**. Las apps ya instaladas en los celulares apuntan a la URL
  vieja y dejan de funcionar.
- **La notebook tiene que quedar encendida, conectada a internet y sin suspenderse**
  durante todo el evento (Configuración de Windows → Sistema → Energía: que no
  entre en suspensión enchufada, y dejarla enchufada). Si se suspende o se cierra la
  tapa, la app se cae para todos.
- Los túneles rápidos de Cloudflare (`trycloudflare.com`) son para pruebas: no tienen
  garantía de disponibilidad. Por eso es el plan B y no el A.
- Los datos quedan en la notebook (en el volumen de Docker), no en Neon.
