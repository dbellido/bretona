// Pega aquí la configuración de tu proyecto de Firebase
// (Consola de Firebase → Configuración del proyecto → Tus apps → App web → "Configuración del SDK").
export const firebaseConfig = {
  apiKey: "AIzaSyDpO5a5kXx86i_vZ0liI3ftZPh61nJqIiQ",
  authDomain: "bretona-33bab.firebaseapp.com",
  projectId: "bretona-33bab",
  storageBucket: "bretona-33bab.firebasestorage.app",
  messagingSenderId: "190741670715",
  appId: "1:190741670715:web:bb73f1af5ea834b9b5a51e",
};

// Modelos de Gemini para leer fotos, en orden de preferencia.
// Si el primero no está disponible en el plan gratuito, la app prueba el siguiente.
export const geminiModels = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
