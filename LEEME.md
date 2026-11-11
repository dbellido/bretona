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

## Si algo falla
- **"Falta conectar la base de datos"**: revisa el paso 2.
- **"No se ha podido iniciar sesión"**: revisa el paso 3.
- **"No se ha podido crear la lista"**: revisa que las reglas del paso 4 estén publicadas.
- **"La lectura de fotos no está activada"**: revisa el paso 5. Si sigue fallando, cambia el orden de los modelos en `firebase-config.js` (`geminiModels`); los nombres de los modelos de Gemini cambian con el tiempo.
- **Cambiaste de móvil o borraste la app**: vuelve a unirte con el código. Tus productos siguen ahí.
- **Para actualizar la app**: sube los archivos nuevos al repositorio. Los móviles la actualizan solos al abrirla con conexión.
