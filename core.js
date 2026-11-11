// Utilidades compartidas por todas las pestañas de BRETONA.
import { geminiModels } from "./firebase-config.js";

export const FB = "https://www.gstatic.com/firebasejs/12.19.0/";

// Estado compartido: lo rellena app.js al arrancar y al abrir la familia.
export const ctx = { F: {}, app: null, fs: null, uid: null, hid: null, house: null };

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cap = (s) => { s = String(s || "").trim().replace(/\s+/g, " "); return s ? s[0].toUpperCase() + s.slice(1) : s; };
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n").trim();
export const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const uidShort = () => Math.random().toString(36).slice(2, 10);
export const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/* ---------- Secciones del súper y clasificación automática ---------- */
export const AISLES = [
  { id: "fruta", name: "Fruta y verdura", c: "#3f9a4f", k: ["manzana","platano","naranja","mandarina","limon","fresa","uva","pera","melocoton","tomate","lechuga","cebolla","ajo","patata","zanahoria","pimiento","calabacin","berenjena","pepino","aguacate","espinaca","brocoli","coliflor","fruta","verdura","melon","sandia","kiwi","champinon","seta","perejil","cilantro","puerro","judia verde","alcachofa","calabaza","mango","pina","cereza"] },
  { id: "carne", name: "Carne y pescado", c: "#c2553a", k: ["pollo","carne","ternera","cerdo","cordero","jamon","pavo","chorizo","salchicha","hamburguesa","pescado","merluza","salmon","gamba","langostino","bacalao","lomo","filete","embutido","fuet","salchichon","mortadela","sepia","calamar","mejillon","dorada","lubina","costilla","picada"] },
  { id: "lacteos", name: "Lácteos y huevos", c: "#d9a520", k: ["leche","yogur","queso","mantequilla","nata","huevo","kefir","batido","cuajada","natillas","flan"] },
  { id: "panaderia", name: "Pan y desayuno", c: "#a8743a", k: ["pan","tostada","galleta","cereal","cafe","te ","infusion","cacao","magdalena","bolleria","mermelada","colacao","croissant","bizcocho","miel"] },
  { id: "despensa", name: "Despensa", c: "#6a7b3a", k: ["arroz","pasta","macarron","espagueti","fideo","harina","azucar","sal","aceite","vinagre","lenteja","garbanzo","alubia","atun","sardina","conserva","tomate frito","especia","pimenton","oregano","legumbre","caldo","sopa","mayonesa","ketchup","mostaza","aceituna","patatas fritas","frutos secos","chocolate","levadura"] },
  { id: "bebidas", name: "Bebidas", c: "#2f7fb5", k: ["agua","zumo","refresco","cerveza","vino","coca","bebida","gaseosa","tonica","cava","sidra","leche de avena","bebida vegetal"] },
  { id: "congelados", name: "Congelados", c: "#5a9fb8", k: ["congelad","helado","pizza","croqueta","guisante","empanadilla","hielo","varitas"] },
  { id: "limpieza", name: "Limpieza y hogar", c: "#7d5fb2", k: ["lejia","detergente","suavizante","friegasuelos","lavavajillas","bolsa de basura","bolsas","estropajo","papel de cocina","servilleta","esponja","limpiador","ambientador","papel de aluminio","film","bombilla","pila","fregona","bayeta"] },
  { id: "higiene", name: "Higiene", c: "#b5487f", k: ["champu","gel","pasta de dientes","dentifrico","cepillo","desodorante","papel higienico","compresa","tampon","panal","toallita","crema","jabon","colonia","maquinilla","cuchilla","algodon","tirita"] },
  { id: "otros", name: "Otros", c: "#7c8a83", k: [] },
];
export const AISLE_IDS = AISLES.map((a) => a.id);
export function guessAisle(name) {
  const n = " " + norm(name) + " ";
  let best = null, len = 0;
  for (const a of AISLES) for (const k of a.k) if (n.includes(k) && k.length > len) { best = a.id; len = k.length; }
  return best || "otros";
}

/* ---------- Firestore ---------- */
export const sub = (name) => ctx.F.collection(ctx.fs, "households", ctx.hid, name);
export const subDoc = (name, id) => ctx.F.doc(ctx.fs, "households", ctx.hid, name, id);
export const houseRef = () => ctx.F.doc(ctx.fs, "households", ctx.hid);
export const memberName = (id) => ctx.house?.memberNames?.[id] || "";
export const stores = () => ctx.house?.stores || [];

/* ---------- Avisos ---------- */
let toastTimer;
export function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg || "";
  t.hidden = !msg;
  clearTimeout(toastTimer);
  if (msg && ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}
export function failed(e) {
  console.error(e);
  toast(e?.code === "permission-denied"
    ? "No se ha guardado: faltan permisos. Revisa las reglas de Firestore (LEEME, paso 4)."
    : "No se ha guardado. Revisa la conexión.");
}

/* ---------- Fechas ---------- */
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const fmt = (opts) => new Intl.DateTimeFormat("es-ES", opts);
export const fmtDay = (s) => s ? fmt({ weekday: "short", day: "numeric", month: "short" }).format(parseYmd(s)) : "";
export const fmtDayLong = (s) => s ? fmt({ weekday: "long", day: "numeric", month: "long" }).format(parseYmd(s)) : "";
export const fmtDate = (s) => s ? fmt({ day: "numeric", month: "short", year: "numeric" }).format(parseYmd(s)) : "";
export const fmtMonth = (s) => fmt({ month: "short" }).format(parseYmd(s)).replace(".", "");
export function relDay(s) {
  const n = daysBetween(ymd(), s);
  if (n === 0) return "Hoy";
  if (n === 1) return "Mañana";
  if (n === -1) return "Ayer";
  if (n > 1 && n < 7) return `En ${n} días`;
  if (n >= 7 && n < 60) return `En ${Math.round(n / 7)} ${Math.round(n / 7) === 1 ? "semana" : "semanas"}`;
  if (n >= 60) return `En ${Math.round(n / 30)} meses`;
  return `Hace ${-n} días`;
}
export const euro = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
export const parseEuro = (s) => { const n = parseFloat(String(s).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")); return isFinite(n) ? Math.round(n * 100) / 100 : null; };

/* ---------- Enlaces externos ---------- */
const gdate = (d) => d.replace(/-/g, "");
// Abre Google Calendar con el evento ya relleno; la persona solo pulsa Guardar.
export function calLink({ title, date, time, endDate, endTime, minutes = 60, details = "", location = "" }) {
  let dates;
  if (time) {
    const [h, m] = time.split(":").map(Number);
    const start = new Date(parseYmd(date)); start.setHours(h, m || 0, 0, 0);
    let end;
    if (endTime) { const [eh, em] = endTime.split(":").map(Number); end = new Date(parseYmd(endDate || date)); end.setHours(eh, em || 0, 0, 0); }
    else end = new Date(start.getTime() + minutes * 60000);
    const f = (d) => `${ymd(d).replace(/-/g, "")}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    dates = `${f(start)}/${f(end)}`;
  } else {
    dates = `${gdate(date)}/${gdate(addDays(endDate || date, 1))}`;
  }
  const p = new URLSearchParams({ action: "TEMPLATE", text: title, dates, details, location, ctz: "Europe/Madrid" });
  const cal = ctx.house?.calendarId;
  if (cal) p.set("src", cal);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
export const mapsLink = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
export const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

/* ---------- Fotos y Gemini ---------- */
export async function shrink(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);
    return { preview: dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Devuelve el JSON que responde Gemini, o lanza un Error con un mensaje para la persona.
export async function askGemini(prompt, base64) {
  let text = null, lastErr = null;
  try {
    if (!ctx.F.getAI) Object.assign(ctx.F, await import(FB + "firebase-ai.js"));
    const ai = ctx.F.getAI(ctx.app, { backend: new ctx.F.GoogleAIBackend() });
    for (const model of geminiModels) {
      try {
        const m = ctx.F.getGenerativeModel(ai, { model, generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
        const r = await m.generateContent([prompt, { inlineData: { data: base64, mimeType: "image/jpeg" } }]);
        text = r.response.text();
        break;
      } catch (e) { lastErr = e; console.warn("Modelo", model, e); }
    }
  } catch (e) { lastErr = e; }
  if (text == null) {
    const msg = String(lastErr?.message || lastErr || "");
    throw new Error(!navigator.onLine
      ? "Sin conexión. Para leer fotos hace falta internet."
      : /api-not-enabled|not enabled|PERMISSION_DENIED|403/i.test(msg)
        ? "La lectura de fotos no está activada en Firebase (LEEME, paso 5)."
        : /quota|429|RESOURCE_EXHAUSTED/i.test(msg)
          ? "Se ha llegado al límite gratuito de fotos por ahora. Prueba dentro de un rato."
          : "No se ha podido leer la foto. Prueba otra vez o con más luz.");
  }
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch { return null; }
}

/* ---------- Formularios ---------- */
export function storeOptions(selected, { any = "Cualquier tienda", addNew = true } = {}) {
  const list = [...stores()];
  if (selected && !list.includes(selected)) list.push(selected);
  return `<option value="">${esc(any)}</option>` +
    list.map((s) => `<option value="${esc(s)}"${s === selected ? " selected" : ""}>${esc(s)}</option>`).join("") +
    (addNew ? `<option value="__new">+ Nueva tienda…</option>` : "");
}
export async function newStore() {
  const s = cap(prompt("Nombre del supermercado o tienda:") || "").slice(0, 30);
  if (!s) return "";
  const existing = stores().find((x) => norm(x) === norm(s));
  if (existing) return existing;
  await ctx.F.updateDoc(houseRef(), { stores: ctx.F.arrayUnion(s) }).catch(failed);
  ctx.house = { ...ctx.house, stores: [...stores(), s] };
  return s;
}
// Lee los campos de un formulario por id: { campo: valor }
export const val = (id) => ($(id).value || "").trim();
