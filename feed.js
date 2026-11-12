// Lee los eventos del calendario de Google a través del programa (Apps Script) de la familia.
import { ctx, LS, norm, callScript, CLAVE_MSG } from "./core.js";

let events = null;      // null = sin configurar o aún sin leer
let status = "";        // "", "loading", "error"
let errorMsg = "";
let fetchedAt = 0;
let inflight = null;
const listeners = new Set();
const CACHE = "bretona.feed";

export const feedState = () => ({ events, status, errorMsg, fetchedAt, configured: !!ctx.house?.calendarFeed });
export const onFeed = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

// Palabras que convierten un evento del calendario en una cita médica.
const MED = ["medico", "medica", "pediatra", "dentista", "odontolog", "ortodonc", "cita medica", "consulta", "analisis", "analitica", "extraccion", "revision medica",
  "vacuna", "hospital", "centro de salud", "ambulatorio", "enfermer", "fisio", "oftalmo", "oculista", "optica", "dermat", "gineco", "matrona", "trauma",
  "cardio", "otorrino", "psicolog", "psiquiatr", "logoped", "urgencias", "clinica", "ecografia", "radiografia", "resonancia", "mamografia", "alergolog",
  "endocrino", "neurolog", "urolog", "digestivo", "podolog", "osteopata", "cirujano", "operacion", "pruebas", "mutua", "sanitas", "adeslas", "asisa", "dkv"];
const NOT_MED = ["coche", "itv", "taller", "veterinari", "perro", "gato"];
export function isMedical(ev) {
  const t = " " + norm(ev.title) + " ";
  if (NOT_MED.some((w) => t.includes(w))) return false;
  return MED.some((w) => t.includes(w)) || /\bcita\b/.test(t) || /\brevision\b/.test(t);
}

function normalize(list) {
  return (list || []).filter((e) => e && e.start).map((e) => ({
    id: String(e.id || e.start + e.title),
    title: String(e.title || "(Sin título)").slice(0, 200),
    date: String(e.start).slice(0, 10),
    time: e.allDay ? "" : String(e.start).slice(11, 16),
    endDate: String(e.end || e.start).slice(0, 10),
    endTime: e.allDay ? "" : String(e.end || "").slice(11, 16),
    allDay: !!e.allDay,
    location: String(e.location || "").slice(0, 200),
    description: String(e.description || "").slice(0, 500),
  }));
}

function loadCache(url) {
  try {
    const c = JSON.parse(LS.get(CACHE) || "null");
    if (c && c.url === url) { events = c.events; fetchedAt = c.at; return true; }
  } catch {}
  return false;
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ctx.house?.calendarFeed) refreshFeed(); });

export async function refreshFeed(force = false) {
  const url = ctx.house?.calendarFeed;
  if (!url) { events = null; status = ""; emit(); return; }
  if (events === null) loadCache(url);
  if (!force && events && Date.now() - fetchedAt < 10 * 60000) { emit(); return; }
  if (inflight) return inflight;
  status = "loading"; emit();
  inflight = (async () => {
    try {
      const data = await callScript();
      if (data.error) throw new Error(data.error);
      events = normalize(data.events);
      fetchedAt = Date.now(); status = ""; errorMsg = "";
      LS.set(CACHE, JSON.stringify({ url, at: fetchedAt, events }));
    } catch (e) {
      console.error(e);
      status = "error";
      errorMsg = !navigator.onLine ? "Sin conexión: se muestran los eventos guardados."
        : e.message === "clave" ? CLAVE_MSG
        : /calendario/.test(e.message || "") ? "El programa no encuentra el calendario. Revisa el ID que pegaste en él."
        : "No se ha podido leer el calendario. Revisa que la aplicación web esté implementada con acceso «Cualquier usuario».";
    } finally {
      inflight = null; emit();
    }
  })();
  return inflight;
}
