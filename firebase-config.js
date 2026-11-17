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

// Modelos de Gemini, en orden de preferencia. Primero los "Flash-Lite": en el plan gratuito
// permiten unas 500 peticiones al día (los "Flash", unas 20). Cada modelo tiene su propio cupo:
// si uno se agota o no existe, la app pasa al siguiente.
export const geminiModels = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];
