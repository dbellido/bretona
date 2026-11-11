# BRETONA · cómo ponerla en marcha

Todo es gratis: Firebase (plan Spark, sin tarjeta) guarda la lista y lee las fotos, y GitHub Pages publica la app. Se tarda unos 15 minutos y solo se hace una vez.

## 1. Crear el proyecto de Firebase
1. Entra en https://console.firebase.google.com con tu cuenta de Google.
2. **Crear un proyecto** → nombre `bretona` → Google Analytics puedes desactivarlo → Crear.
3. Comprueba que el plan es **Spark (gratis)**. No hace falta añadir tarjeta.

## 2. Registrar la app web y copiar la configuración
1. En la portada del proyecto pulsa el icono **`</>` (Web)**.
2. Apodo: `bretona`. No marques Firebase Hosting. Pulsa **Registrar app**.
3. Te enseña un bloque `const firebaseConfig = { apiKey: ..., ... }`.
4. Copia esos valores en `firebase-config.js`, sustituyendo cada `PEGA_AQUI`.

> La `apiKey` de Firebase no es secreta: identifica el proyecto. Lo que protege los datos son las reglas del paso 4.

## 3. Activar el acceso anónimo
Menú **Compilación → Authentication → Comenzar → Método de acceso → Anónimo → Habilitar → Guardar**.

Nadie necesita contraseña: cada móvil recibe una identidad propia y entra en la familia con el código de invitación.

## 4. Crear la base de datos y sus reglas
1. **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: `europe-southwest1 (Madrid)` o `eur3 (Europa)`. Modo: **producción**.
3. Pestaña **Reglas**: borra lo que haya, pega el contenido de `firestore.rules` y pulsa **Publicar**.

## 5. Activar la lectura de fotos (Gemini)
1. Menú **Compilación → AI Logic → Comenzar** (en algunas versiones aparece como "Firebase AI Logic").
2. Elige **Gemini Developer API** (la que tiene nivel gratuito). No elijas Vertex AI, que pide plan de pago.
3. Acepta. Firebase crea la clave por ti; no tienes que copiar nada.

El nivel gratuito tiene un límite de peticiones por minuto y por día, de sobra para una familia. Si algún día se pasa, la app avisa y basta con esperar.

## 6. Publicar la app en GitHub Pages
1. Crea una cuenta en https://github.com si no tienes.
2. **New repository** → nombre `bretona` → **Public** → Create.
3. **Add file → Upload files** y arrastra **todo el contenido de la carpeta** (no la carpeta en sí): `index.html`, `app.js`, `styles.css`, `firebase-config.js`, `manifest.webmanifest`, `sw.js`, `firestore.rules`, `LEEME.md` y la carpeta `icons`. Pulsa **Commit changes**.
4. **Settings → Pages → Branch: `main` / `(root)` → Save**.
5. En un par de minutos la app estará en `https://TU-USUARIO.github.io/bretona/`.
6. Vuelve a Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio** → `TU-USUARIO.github.io`.

## 7. Instalarla en el móvil
- **iPhone**: abre el enlace en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
- **Android**: abre el enlace en **Chrome** → menú ⋮ → **Instalar aplicación** (o "Añadir a pantalla de inicio").

Ábrela siempre desde el icono. En iPhone, la app instalada y Safari no comparten datos, así que crea o únete a la familia desde el icono.

## 8. Crear la familia e invitar
1. La primera persona abre BRETONA, escribe su nombre y pulsa **Crear la lista de mi familia**.
2. En el icono de personas (arriba a la derecha) está el **código de invitación** (`BRT-XXXX-XXXX`) y el botón **Enviar** para mandarlo por WhatsApp.
3. Los demás instalan la app, escriben su nombre y el código, y pulsan **Unirme**.

## Qué hace
- Lista compartida en tiempo real, ordenada por secciones del súper.
- Cada producto puede llevar **tienda o supermercado**. Arriba puedes filtrar por tienda: al filtrar por Mercadona ves lo de Mercadona y lo que no tiene tienda asignada.
- **Foto → lista**: el botón de la cámara lee una lista de papel, un ticket, una receta o una nota, y te deja revisar los productos antes de añadirlos.
- Funciona sin cobertura dentro del súper: los cambios se envían al recuperar la conexión. Leer fotos sí necesita internet.
- "Lo de siempre": lo que habéis comprado aparece abajo para volver a añadirlo con un toque.

## Pestañas
- **Compra**: la lista compartida.
- **Gastos**: haz una foto al ticket y se apunta la tienda, la fecha y el total. Lo que marcáis como comprado en la lista también queda guardado, para ver qué compráis y cada cuánto.
- **Viajes**: cada viaje con sus reservas (vuelos, hotel, coche…) y el plan de cada día.
- **Calendario**: vuestro calendario compartido de Google dentro de la app. Se conecta una vez pegando el ID del calendario (la pestaña explica dónde encontrarlo).
- **Tareas**: tareas de casa con persona, fecha y repetición (cada día, semana, 2 semanas o mes).
- **Citas**: las citas médicas de toda la familia. Las del calendario de Google salen solas; con ••• se dice para quién son (por ejemplo, Gael) o se ocultan si no son médicas.
- **Más → Menú**: comidas de la semana propuestas por Gemini (equilibradas, variadas y fáciles), con receta, favoritas que salen más a menudo, descartadas que no vuelven y un botón para pasar los ingredientes a la lista de la compra.
- **Más → Pisos (beta)**: anuncios de las alertas por correo de idealista, Fotocasa y yaencontré. Cada miembro vota; si todos dicen «Me gusta», pasa a Favoritos.

## Leer el calendario de Google (opcional)
Para que los eventos salgan como lista dentro de BRETONA y las citas médicas aparezcan solas en Citas:
1. En el ordenador, abre https://script.google.com con la cuenta de Google que ve el calendario de la familia → **Nuevo proyecto**.
2. Borra lo que haya y pega el contenido de `calendario-google.gs`. Cambia `PEGA_AQUI_EL_ID_DEL_CALENDARIO` por el ID del calendario.
3. Guarda (icono del disquete). Arriba elige la función `probar` → **Ejecutar** → autoriza el acceso (Google avisará de que la app no está verificada: **Configuración avanzada → Ir a … (no seguro)**; es tu propio programa).
4. **Implementar → Nueva implementación** → tipo **Aplicación web** → Ejecutar como: **Yo** → Quién tiene acceso: **Cualquier usuario** → Implementar.
5. Copia la **URL de la aplicación web** (acaba en `/exec`) y pégala en BRETONA → Calendario → Configurar.

Cualquiera con esa dirección puede ver los eventos del calendario, igual que con la "dirección secreta" de Google Calendar: no la compartas fuera de la familia.

## Pisos: alertas de los portales (beta)
1. En idealista, Fotocasa y yaencontré, haced una búsqueda con vuestros criterios y guardadla como **alerta por correo**, con el Gmail donde está el programa de Google (o reenviad a ese Gmail las alertas que os lleguen a otro correo).
2. Pega en el programa de Google la versión nueva de `calendario-google.gs` (manteniendo tu ID de calendario), ejecuta `probarPisos` para dar permiso de lectura del correo, y en **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la dirección no cambia.
3. BRETONA lee esos correos al abrir Pisos (o con «Actualizar»).

Cada piso muestra el tiempo en transporte público hasta Nuevos Ministerios o Chamartín (saliendo a las 8:30 de un laborable). Los de más de 40 minutos van a «No cumplen». Se puede cambiar en Criterios. Como las alertas no suelen dar la dirección exacta, el tiempo es aproximado: si la sabéis, ponedla en ••• del piso.

BRETONA no entra en los portales: solo lee los correos de alerta que os mandan ellos.

## Si algo falla
- **"Falta conectar la base de datos"**: revisa el paso 2.
- **"No se ha podido iniciar sesión"**: revisa el paso 3.
- **"No se ha podido crear la lista"**: revisa que las reglas del paso 4 estén publicadas.
- **"La lectura de fotos no está activada"**: revisa el paso 5. Si sigue fallando, cambia el orden de los modelos en `firebase-config.js` (`geminiModels`); los nombres de los modelos de Gemini cambian con el tiempo.
- **Cambiaste de móvil o borraste la app**: vuelve a unirte con el código. Tus productos siguen ahí.
- **Para actualizar la app**: sube los archivos nuevos al repositorio. Los móviles la actualizan solos al abrirla con conexión.
