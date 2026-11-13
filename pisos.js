// Pestaña Pisos (beta): anuncios de las alertas de Idealista, Fotocasa y Yaencontre,
// leídos del correo por el programa de Google. Cada miembro vota; si todos dicen que sí, pasa a Favoritos.
import {
  ctx, $, esc, cap, norm, toast, failed, sub, subDoc, houseRef, memberName, callScript, CLAVE_MSG, askGemini,
  ymd, fmtDate, euro, parseEuro, safeUrl, knownPeople, personColor, LS,
} from "./core.js";

let pisos = [], unsub = null;
let tab = LS.get("bretona.pisotab") || "revisar"; // revisar | favoritos | descartados | fuera
let syncing = false, syncMsg = "", lastSync = 0;
let editingId = null;

const PORTALS = { idealista: "idealista", fotocasa: "Fotocasa", yaencontre: "yaencontré", otro: "Otro" };

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-piso" class="sheet">
  <form method="dialog" id="ps-form">
    <h2 id="ps-title">Añadir anuncio</h2>
    <label class="field"><span>Enlace del anuncio</span><input id="ps-url" type="url" placeholder="https://www.idealista.com/inmueble/…" required spellcheck="false"></label>
    <label class="field"><span>Título</span><input id="ps-name" maxlength="120" placeholder="Piso en calle Mayor, 3 habitaciones"></label>
    <div class="row">
      <label class="field"><span>Precio (€)</span><input id="ps-price" inputmode="numeric" placeholder="285.000"></label>
      <label class="field"><span>Habitaciones</span><input id="ps-rooms" inputmode="numeric" maxlength="2"></label>
      <label class="field"><span>m²</span><input id="ps-size" inputmode="numeric" maxlength="4"></label>
    </div>
    <div class="row">
      <label class="field"><span>Garaje</span><select id="ps-garage"><option value="">No se sabe</option><option value="si">Sí</option><option value="no">No</option></select></label>
      <label class="field"><span>Trastero</span><select id="ps-storage"><option value="">No se sabe</option><option value="si">Sí</option><option value="no">No</option></select></label>
    </div>
    <label class="field"><span>Dirección (para el trayecto)</span><input id="ps-addr" maxlength="160" placeholder="Calle de Bravo Murillo 150, Madrid"></label>
    <label class="field"><span>Notas</span><textarea id="ps-notes" rows="3" maxlength="1000" placeholder="Lo que os ha gustado o no, preguntas para la visita…"></textarea></label>
    <p class="note" id="ps-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="ps-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-criteria" class="sheet">
  <form method="dialog" id="cr-form">
    <h2>Criterios</h2>
    <p class="muted">Lo principal (zona, tipo de vivienda, precio) se elige en la alerta de cada portal. Aquí puedes afinar: los anuncios que no cumplan van a «No cumplen» y no hace falta votarlos.</p>
    <div class="row">
      <label class="field"><span>Precio máximo (€)</span><input id="cr-price" inputmode="numeric" placeholder="300.000"></label>
      <label class="field"><span>Habitaciones mín.</span><input id="cr-rooms" inputmode="numeric" maxlength="2"></label>
      <label class="field"><span>m² mín.</span><input id="cr-size" inputmode="numeric" maxlength="4"></label>
    </div>
    <div class="row">
      <label class="field"><span>Máx. minutos en transporte</span><input id="cr-min" inputmode="numeric" maxlength="3" placeholder="40"></label>
      <label class="field"><span>Saliendo a las</span><input id="cr-hour" type="time" value="08:30"></label>
    </div>
    <p class="muted small-print">Tiempo en transporte público hasta Nuevos Ministerios o Chamartín (el más cercano), un día laborable. Déjalo vacío para no filtrar por trayecto.</p>
    <button class="btn ghost" type="button" id="cr-reread">Volver a leer los datos de los anuncios</button>
    <p class="muted small-print">Gemini vuelve a leer precio, m², habitaciones, garaje y trastero de los correos de alertas (también de la papelera). No cambia los que hayáis corregido a mano.</p>
    <label class="check-row"><input type="checkbox" id="cr-trash"> Mandar a la papelera de Gmail los correos de alertas ya guardados en BRETONA</label>
    <label class="field"><span>Descartar si el título contiene</span><input id="cr-words" maxlength="200" placeholder="bajo, nuda propiedad, okupado"></label>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("pisos"), (s) => {
    pisos = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render(); ctx.onPisos?.();
    // Al abrir la app, leer alertas y calcular trayectos en segundo plano (sin esperar a entrar en Pisos).
    if (firstSnap) { firstSnap = false; setTimeout(() => sync(), 4000); }
    scheduleRoutes();
  }, (e) => console.error(e));
}
let firstSnap = true;
export function stop() { unsub?.(); unsub = null; pisos = []; firstSnap = true; }
export function onShow() { render(); sync(); scheduleRoutes(); }
export function onHouse() { render(); }

/* ---------- Estado de cada anuncio ---------- */
const deciders = () => ctx.house?.members || [];
// Por defecto: 40 minutos en transporte público saliendo a las 8:30 de un laborable.
const criteria = () => ({ maxMinutes: 40, hour: "08:30", ...(ctx.house?.pisoCriteria || {}) });
function fits(p) {
  const c = criteria();
  if (c.maxMinutes && p.transit?.min && p.transit.min > c.maxMinutes) return false;
  if (c.maxPrice && p.price && p.price > c.maxPrice) return false;
  if (c.minRooms && p.rooms && p.rooms < c.minRooms) return false;
  if (c.minSize && p.size && p.size < c.minSize) return false;
  const words = String(c.words || "").split(",").map((w) => norm(w)).filter(Boolean);
  if (words.length && words.some((w) => norm(p.title).includes(w))) return false;
  return true;
}
function status(p) {
  const v = p.votes || {};
  if (Object.values(v).includes("no")) return "descartados";
  if (deciders().length && deciders().every((m) => v[m] === "si")) return "favoritos";
  if (!fits(p) && !Object.keys(v).length) return "fuera";
  return "revisar";
}
// Anuncios que esta persona aún tiene que votar (para el aviso de la barra).
export const myPendingCount = () => pisos.filter((p) => status(p) === "revisar" && !(p.votes || {})[ctx.uid]).length;

/* ---------- Leer los correos de alertas (a través del programa de Google) ---------- */
async function sync(force = false) {
  if (!ctx.house?.calendarFeed || syncing || (!force && Date.now() - lastSync < 10 * 60000)) return;
  syncing = true; syncMsg = ""; render();
  try {
    const data = await callScript({ tipo: "pisos" });
    if (!Array.isArray(data.pisos)) throw new Error(data.error || "sin pisos");
    const byId = new Map(pisos.map((p) => [p.id, p]));
    const fresh = data.pisos.filter((a) => a && a.id && !byId.has(safeId(a.id)));
    // Gemini lee los datos de cada anuncio en su correo (más fiable que buscar números en el texto).
    if (fresh.length && data.correos) { syncMsg = "Leyendo los datos de los anuncios…"; render(); await enrich(fresh, data.correos); }
    // A los anuncios que ya estaban, completarles garaje y trastero si ahora se saben.
    const upd = data.pisos.filter((a) => a && byId.has(safeId(a.id))).map((a) => [byId.get(safeId(a.id)), a])
      .filter(([p, a]) => (p.garage === undefined && a.garaje != null) || (p.storage === undefined && a.trastero != null));
    const writes = [
      ...fresh.map((a) => (b) => b.set(subDoc("pisos", safeId(a.id)), {
        portal: PORTALS[a.portal] ? a.portal : "otro", url: safeUrl(a.url) || "", title: cap(a.titulo || a.asunto || "Anuncio").slice(0, 160),
        price: Number(a.precio) || null, rooms: Number(a.habitaciones) || null, size: Number(a.m2) || null,
        garage: a.garaje ?? null, storage: a.trastero ?? null,
        img: safeUrl(a.foto) || "", place: String(a.zona || "").slice(0, 120), mailDate: String(a.fecha || "").slice(0, 10),
        source: "alerta", addedAt: Date.now(),
      }, { merge: true })),
      ...upd.map(([p, a]) => (b) => b.update(subDoc("pisos", p.id), {
        ...(p.garage === undefined && a.garaje != null ? { garage: a.garaje } : {}),
        ...(p.storage === undefined && a.trastero != null ? { storage: a.trastero } : {}),
      })),
    ];
    for (let i = 0; i < writes.length; i += 400) {
      const b = ctx.F.writeBatch(ctx.fs);
      writes.slice(i, i + 400).forEach((w) => w(b));
      await b.commit();
    }
    lastSync = Date.now();
    syncMsg = fresh.length ? `${fresh.length} ${fresh.length === 1 ? "anuncio nuevo" : "anuncios nuevos"}` : "";
    // Todos los pisos de estos correos ya están guardados: mandar los correos a la papelera (si está activado).
    const mailIds = [...new Set(data.pisos.map((a) => a && a.correo).filter(Boolean))];
    if (criteria().trashMails !== false && mailIds.length) {
      try {
        const r = await callScript({ tipo: "borrar", ids: mailIds.join(",") });
        if (r.borrados) syncMsg = [syncMsg, `${r.borrados} ${r.borrados === 1 ? "correo" : "correos"} a la papelera`].filter(Boolean).join(" · ");
      } catch (e) { console.error(e); }
    }
  } catch (e) {
    console.error(e);
    syncMsg = e.message === "clave" ? CLAVE_MSG : /sin pisos/.test(e.message) ? "El programa de Google aún no sabe leer las alertas. Actualízalo con el texto nuevo (te lo da Claude)." : "No se han podido leer las alertas ahora.";
  } finally {
    syncing = false; render();
  }
}
/* ---------- Leer los datos de los anuncios con Gemini ---------- */
function enrichPrompt(text, ids) {
  return `Esto es un correo de alertas de pisos EN VENTA de un portal inmobiliario español. Cada anuncio está marcado con [[ID]] (puede salir varias veces: en la foto y en el título).
Los datos de cada anuncio están junto a su marca: a veces justo antes (por ejemplo, el precio encima de la foto) y a veces justo después. No mezcles los datos de un anuncio con los del siguiente.
Anuncios a leer: ${ids.join(", ")}
Responde SOLO con JSON con esta forma exacta:
{"anuncios":[{"id":"idealista-123","precio":320000,"m2":95,"habitaciones":3,"garaje":true,"trastero":null,"titulo":"Piso en calle de Orense, Cuatro Caminos","zona":"Cuatro Caminos"}]}
Reglas:
- "precio": en euros, número sin puntos. Si aparece una bajada de precio, el precio NUEVO.
- "m2": metros cuadrados construidos (número). "habitaciones": número.
- "garaje" y "trastero": true si el anuncio dice que lo tiene o lo incluye, false si dice que no, null si no se menciona.
- "titulo": el título del anuncio tal cual. "zona": barrio o zona si aparece.
- NO inventes: si un dato no aparece junto al anuncio, pon null.

TEXTO DEL CORREO:
${text}`;
}
// Completa (y corrige) los datos de los anuncios con lo que Gemini lea en sus correos.
async function enrich(list, correos) {
  const byMail = new Map();
  for (const a of list) if (a.correo && correos[a.correo]) (byMail.get(a.correo) || byMail.set(a.correo, []).get(a.correo)).push(a);
  let n = 0;
  for (const [mail, items] of byMail) {
    if (n++ >= 12) break; // el resto, en la siguiente lectura
    try {
      const d = await askGemini(enrichPrompt(correos[mail], items.map((a) => a.id)), null, { temperature: 0 });
      const got = new Map((Array.isArray(d) ? d : d?.anuncios || []).map((x) => [x.id, x]));
      for (const a of items) {
        const x = got.get(a.id); if (!x) continue;
        const num = (v) => (typeof v === "number" ? v : parseEuro(v)) || null;
        if (num(x.precio)) a.precio = Math.round(num(x.precio));
        if (num(x.m2)) a.m2 = Math.round(num(x.m2));
        if (num(x.habitaciones)) a.habitaciones = Math.round(num(x.habitaciones));
        if (typeof x.garaje === "boolean") a.garaje = x.garaje;
        if (typeof x.trastero === "boolean") a.trastero = x.trastero;
        if (x.titulo) a.titulo = String(x.titulo);
        if (x.zona) a.zona = String(x.zona);
        a.leido = true;
      }
    } catch (e) { console.error(e); }
  }
}

// Volver a leer los datos de los anuncios ya guardados (también de correos en la papelera).
// No toca los que se hayan corregido a mano.
async function reread() {
  if (syncing) return;
  syncing = true; syncMsg = "Buscando los correos de alertas…"; render();
  try {
    const data = await callScript({ tipo: "pisos", releer: "1" });
    if (!Array.isArray(data.pisos) || !data.correos) throw new Error("viejo");
    const byId = new Map(pisos.map((p) => [p.id, p]));
    const list = data.pisos.filter((a) => a && byId.has(safeId(a.id)) && !byId.get(safeId(a.id)).edited);
    if (!list.length) { syncMsg = "No hay anuncios que volver a leer."; return; }
    syncMsg = `Leyendo los datos de ${list.length} anuncios…`; render();
    await enrich(list, data.correos);
    const b = ctx.F.writeBatch(ctx.fs);
    let changed = 0;
    for (const a of list) {
      if (!a.leido) continue;
      b.update(subDoc("pisos", safeId(a.id)), {
        price: Number(a.precio) || null, size: Number(a.m2) || null, rooms: Number(a.habitaciones) || null,
        ...(byId.get(safeId(a.id)).manual?.garage ? {} : { garage: a.garaje ?? null }),
        ...(byId.get(safeId(a.id)).manual?.storage ? {} : { storage: a.trastero ?? null }),
        title: cap(a.titulo || byId.get(safeId(a.id)).title).slice(0, 160),
        place: String(a.zona || "").slice(0, 120),
      });
      changed++;
    }
    if (changed) await b.commit();
    syncMsg = changed ? `Datos corregidos en ${changed} ${changed === 1 ? "anuncio" : "anuncios"}` : "Gemini no ha podido leer los correos. Prueba más tarde.";
    if (list.length > changed && changed) syncMsg += ` (quedan ${list.length - changed}: vuelve a pulsarlo)`;
  } catch (e) {
    console.error(e);
    syncMsg = e.message === "clave" ? CLAVE_MSG : e.message === "viejo" ? "Actualiza el programa de Google para volver a leer los datos (te lo explica Claude)." : "No se han podido volver a leer los datos.";
  } finally {
    syncing = false; render();
  }
}

/* ---------- Trayecto en transporte público (a través del programa de Google) ---------- */
// De dónde sale el trayecto: la dirección escrita a mano o, si no, la calle/barrio del título del anuncio.
function originOf(p) {
  let o = (p.address || "").trim();
  if (!o) {
    o = String(p.title || "").replace(/^(piso|casa|chalet|[aá]tico|d[uú]plex|apartamento|estudio|vivienda|adosado|planta baja|loft)( [a-záéíóúñ]+)?\s+en\s+/i, "");
    if (p.place) o += ", " + p.place;
    if (o.length < 6 || /^anuncio/i.test(o)) return "";
  }
  return /madrid/i.test(o) ? o : o + ", Madrid";
}
let routing = false, routeQueue = 0;
// Cada vez que cambia la lista (anuncios nuevos, dirección corregida…), calcular los trayectos que falten.
let routeTimer = null;
function scheduleRoutes() { clearTimeout(routeTimer); routeTimer = setTimeout(routes, 1500); }
const routeKey = (p) => originOf(p) + "|" + criteria().hour;
const needsRoute = (p) => status(p) !== "descartados" && originOf(p) && p.transit?.query !== routeKey(p);
const retryFailed = (p) => p.transit?.failedAt && p.transit.query === routeKey(p) && p.transit.failedAt < Date.now() - 86400000;
// Calcula los trayectos que falten, de 3 en 3, sin parar si uno falla.
async function routes() {
  if (!ctx.house?.calendarFeed || routing) return;
  const c = criteria();
  const todo = pisos.filter((p) => needsRoute(p) || retryFailed(p)).slice(0, 80);
  if (!todo.length) return;
  routing = true; routeQueue = todo.length; render();
  let stopMsg = "";
  const one = async (p) => {
    if (stopMsg) return;
    const q = originOf(p);
    try {
      const d = await callScript({ tipo: "ruta", hora: c.hour, origen: q });
      if (d.mejor) await ctx.F.updateDoc(subDoc("pisos", p.id), { transit: { min: d.mejor.min, dest: d.mejor.destino, all: d.tiempos || {}, from: String(d.desde || "").slice(0, 160), query: q + "|" + c.hour, at: Date.now() } });
      else if (d.error === "sin ruta") await ctx.F.updateDoc(subDoc("pisos", p.id), { transit: { query: q + "|" + c.hour, failedAt: Date.now() } });
      else stopMsg = "Actualiza el programa de Google para calcular trayectos (te lo explica Claude).";
    } catch (e) {
      console.error(e);
      if (e.message === "clave") stopMsg = CLAVE_MSG;
    }
    routeQueue--; render();
  };
  const queue = [...todo];
  await Promise.all([1, 2, 3].map(async () => { while (queue.length && !stopMsg) await one(queue.shift()); }));
  if (stopMsg) syncMsg = stopMsg;
  routing = false; routeQueue = 0; render();
  if (!stopMsg && pisos.some(needsRoute)) scheduleRoutes(); // quedaban más de 80
}
const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);

/* ---------- Pintar ---------- */
function votesHtml(p, ppl) {
  const v = p.votes || {};
  return `<span class="votes">${deciders().map((m) => {
    const n = memberName(m) || "Alguien", c = personColor(n, ppl), x = v[m];
    return `<span class="vote pc pc-${c} ${x || "pending"}" title="${esc(n)}">${esc(n)} ${x === "si" ? "✓" : x === "no" ? "✕" : "…"}</span>`;
  }).join("")}</span>`;
}
const trainIco = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 11h12M9 21l1.5-3M15 21l-1.5-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function transitHtml(p) {
  const c = criteria();
  if (p.transit?.min) {
    const over = c.maxMinutes && p.transit.min > c.maxMinutes;
    const other = Object.entries(p.transit.all || {}).filter(([k]) => k !== p.transit.dest).map(([k, v]) => `${v} min a ${k}`).join(" · ");
    return `<span class="transit${over ? " over" : ""}" title="${esc(p.transit.from ? "Desde " + p.transit.from : "")}">${trainIco}<b>${p.transit.min} min</b> a ${esc(p.transit.dest)}${other ? `<small> · ${esc(other)}</small>` : ""}</span>
      ${p.address ? "" : `<span class="muted small-print">Calculado desde ${esc(p.transit.from || originOf(p))}. Si sabéis la dirección exacta, ponla en •••.</span>`}`;
  }
  if (p.transit?.failedAt) return `<span class="muted small-print">No se ha podido calcular el trayecto desde «${esc(originOf(p))}». Pon la dirección en •••.</span>`;
  if (!originOf(p)) return `<span class="muted small-print">Pon la dirección en ••• para calcular el trayecto.</span>`;
  if (status(p) === "descartados") return "";
  return `<span class="muted small-print">${routing ? '<span class="spinner"></span>Calculando trayecto…' : "Trayecto pendiente: se calcula en un momento."}</span>`;
}
function card(p, ppl, { swipe = "" } = {}) {
  const mine = (p.votes || {})[ctx.uid];
  const n = (x) => { try { return x.toLocaleString("es-ES", { useGrouping: "always" }); } catch { return x.toLocaleString("es-ES"); } };
  const chip = (v, label, field) => `<button type="button" class="feat ${v === true ? "yes" : v === false ? "no" : "unk"}" data-feat="${field}" aria-label="${label}: ${v === true ? "sí" : v === false ? "no" : "no se sabe"}. Toca para cambiar">${v === true ? "Con " + label : v === false ? "Sin " + label : label + " ?"}</button>`;
  const url = safeUrl(p.url);
  return `<li class="piso${swipe ? " swipe-card " + swipe : ""}" data-id="${esc(p.id)}">
    ${swipe ? '<span class="stamp like" aria-hidden="true">Me gusta</span><span class="stamp nope" aria-hidden="true">No</span>' : ""}
    ${p.img ? `<img class="piso-img" src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div class="piso-body">
      <div class="piso-top"><span class="portal portal-${esc(p.portal)}">${esc(PORTALS[p.portal] || "Otro")}</span>${p.mailDate ? `<span class="muted">${esc(fmtDate(p.mailDate))}</span>` : ""}</div>
      <div class="piso-key">
        <span class="piso-price">${p.price ? n(p.price) + " €" : "Precio ?"}</span>
        <span class="kv"><b>${p.size ? n(p.size) : "?"}</b> m²</span>
        <span class="kv"><b>${p.price && p.size ? n(Math.round(p.price / p.size)) : "?"}</b> €/m²</span>
        ${p.rooms ? `<span class="kv"><b>${p.rooms}</b> hab.</span>` : ""}
      </div>
      <div class="feats">${chip(p.garage, "garaje", "garage")}${chip(p.storage, "trastero", "storage")}</div>
      <span class="piso-title">${esc(p.title)}</span>
      ${p.place ? `<span class="muted">${esc(p.place)}</span>` : ""}
      ${transitHtml(p)}
      ${p.notes ? `<span class="piso-notes">${esc(p.notes)}</span>` : ""}
      <div class="piso-foot">
        ${votesHtml(p, ppl)}
        <span class="piso-links">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Ver anuncio</a>` : ""}<button class="more" data-ps-edit aria-label="Editar">•••</button></span>
      </div>
      ${swipe ? "" : `<div class="vote-btns">
        <button class="btn${mine === "si" ? "" : " ghost"}" data-vote="si">${mine === "si" ? "Me gusta ✓" : "Me gusta"}</button>
        <button class="btn${mine === "no" ? " danger-btn" : " ghost"}" data-vote="no">${mine === "no" ? "No ✕" : "No"}</button>
      </div>`}
    </div>
  </li>`;
}

let drag = null, needRender = false, lastSwipe = null;
function render() {
  const root = $("view-pisos");
  if (!root || !ctx.hid) return;
  if (drag) { needRender = true; return; } // no pintar mientras se desliza una tarjeta
  needRender = false;
  const ppl = knownPeople();
  const groups = { revisar: [], favoritos: [], descartados: [], fuera: [] };
  for (const p of pisos) groups[status(p)].push(p);
  // Primero los que me faltan por votar, luego los más recientes.
  groups.revisar.sort((a, b) => (!!(a.votes || {})[ctx.uid] - !!(b.votes || {})[ctx.uid]) || (b.addedAt || 0) - (a.addedAt || 0));
  for (const k of ["favoritos", "descartados", "fuera"]) groups[k].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (tab === "fuera" && !groups.fuera.length) tab = "revisar";
  const list = groups[tab];
  const configured = !!ctx.house?.calendarFeed;
  const others = deciders().filter((m) => m !== ctx.uid).map((m) => memberName(m) || "alguien");
  root.innerHTML = `
    <div class="view-head"><h1>Pisos <span class="beta">beta</span></h1><button class="btn" id="ps-new">Añadir anuncio</button></div>
    <div class="feed-status">
      <span class="muted">${syncing ? '<span class="spinner"></span>Leyendo alertas…' : routing ? `<span class="spinner"></span>Calculando trayectos… (faltan ${routeQueue})` : esc(syncMsg || (configured ? "Anuncios de las alertas de idealista, Fotocasa y yaencontré" : ""))}</span>
      <span>${configured ? `<button class="link small" id="ps-sync">Actualizar</button> · ` : ""}<button class="link small" id="ps-criteria">Criterios</button></span>
    </div>
    <div class="seg wide" role="tablist">
      <button role="tab" data-ptab="revisar" aria-selected="${tab === "revisar"}">Por revisar · ${groups.revisar.length}</button>
      <button role="tab" data-ptab="favoritos" aria-selected="${tab === "favoritos"}">Favoritos · ${groups.favoritos.length}</button>
      <button role="tab" data-ptab="descartados" aria-selected="${tab === "descartados"}">Descartados</button>
    </div>
    ${tab === "revisar" ? reviewHtml(list, ppl, others) : list.length ? `<ul class="pisos">${list.map((p) => card(p, ppl)).join("")}</ul>` : `<div class="empty">${tab === "revisar"
      ? `<strong>Nada por revisar</strong>${configured ? "Cuando lleguen anuncios de vuestras alertas aparecerán aquí." : "Conecta el programa de Google en la pestaña Calendario para leer las alertas de los portales, o añade anuncios a mano."}`
      : tab === "favoritos" ? `<strong>Aún no hay favoritos</strong>Un piso pasa aquí cuando ${others.length ? "tú y " + others.join(" y ") + " le dais a «Me gusta»" : "todos le dais a «Me gusta»"}.`
      : `<strong>Nada descartado</strong>Basta con que alguien diga «No» para que un piso venga aquí.`}</div>`}
    ${groups.fuera.length && tab !== "fuera" ? `<button class="link small" data-ptab="fuera">Ver los que no cumplen los criterios (${groups.fuera.length})</button>` : ""}
    ${tab === "fuera" ? `<button class="link small" data-ptab="revisar">‹ Volver</button>` : ""}`;
}

// Por revisar: baraja con los que me faltan (deslizar) y, debajo, los que esperan el voto de los demás.
function reviewHtml(list, ppl, others) {
  const mine = list.filter((p) => !(p.votes || {})[ctx.uid]);
  const waiting = list.filter((p) => (p.votes || {})[ctx.uid]);
  const configured = !!ctx.house?.calendarFeed;
  if (!list.length) return `<div class="empty"><strong>Nada por revisar</strong>${configured ? "Cuando lleguen anuncios de vuestras alertas aparecerán aquí." : "Conecta el programa de Google en la pestaña Calendario para leer las alertas de los portales, o añade anuncios a mano."}</div>`;
  const stack = mine.length ? `
    <div class="swipe-wrap">
      <p class="swipe-count">Te ${mine.length === 1 ? "queda 1 piso" : `quedan ${mine.length} pisos`} por ver</p>
      <ul class="stack">${mine.slice(0, 2).reverse().map((p) => card(p, ppl, { swipe: p === mine[0] ? "top" : "next" })).join("")}</ul>
      <div class="swipe-btns">
        <button class="round nope" data-swipe="no" aria-label="No me gusta">✕</button>
        ${lastSwipe ? `<button class="link small" data-undo>Deshacer</button>` : `<span class="muted small-print">Desliza: derecha me gusta, izquierda no</span>`}
        <button class="round like" data-swipe="si" aria-label="Me gusta">♥</button>
      </div>
    </div>` : `<div class="empty"><strong>Ya has visto todos</strong>${waiting.length ? `Faltan los votos de ${esc(others.join(" y ") || "los demás")}.` : ""}${lastSwipe ? ` <button class="link small" data-undo>Deshacer el último</button>` : ""}</div>`;
  return stack + (waiting.length ? `<section class="panel plain"><h2>Esperando a ${esc(others.join(" y ") || "los demás")} · ${waiting.length}</h2><ul class="pisos">${waiting.map((p) => card(p, ppl)).join("")}</ul></section>` : "");
}

/* ---------- Votar y deslizar ---------- */
function vote(p, v, { fromSwipe = false } = {}) {
  const cur = (p.votes || {})[ctx.uid];
  const next = cur === v && !fromSwipe ? undefined : v;
  if (fromSwipe) lastSwipe = { id: p.id, prev: cur };
  p.votes = { ...(p.votes || {}), [ctx.uid]: next }; // se ve al momento; Firestore confirma después
  if (next === undefined) delete p.votes[ctx.uid];
  render();
  ctx.F.updateDoc(subDoc("pisos", p.id), { ["votes." + ctx.uid]: next === undefined ? ctx.F.deleteField() : next }).then(() => {
    if (next === "si" && deciders().every((m) => (p.votes || {})[m] === "si")) toast("¡Piso en favoritos! Os gusta a todos");
  }).catch(failed);
}
function fly(el, dir) {
  const p = pisos.find((x) => x.id === el.dataset.id); if (!p) return;
  el.style.transition = "transform .28s ease-out, opacity .28s";
  el.style.transform = `translateX(${dir * 140}%) rotate(${dir * 22}deg)`;
  el.style.opacity = "0";
  el.classList.add(dir > 0 ? "show-like" : "show-nope");
  setTimeout(() => vote(p, dir > 0 ? "si" : "no", { fromSwipe: true }), 220);
}
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("#view-pisos .swipe-card.top");
  if (!el || e.target.closest("a, button") || e.button > 0) return;
  drag = { el, x0: e.clientX, y0: e.clientY, dx: 0, active: false, pid: e.pointerId };
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.active) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { drag.active = true; drag.el.classList.add("dragging"); try { drag.el.setPointerCapture(drag.pid); } catch {} }
    else if (Math.abs(dy) > 12) { endDrag(); return; }
    else return;
  }
  drag.dx = dx;
  drag.el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
  drag.el.style.setProperty("--like", Math.max(0, Math.min(1, dx / 110)));
  drag.el.style.setProperty("--nope", Math.max(0, Math.min(1, -dx / 110)));
});
function endDrag() {
  const d = drag; drag = null;
  if (d?.active) {
    d.el.classList.remove("dragging");
    if (Math.abs(d.dx) > 100) { fly(d.el, d.dx > 0 ? 1 : -1); return; }
    d.el.style.transition = "transform .2s"; d.el.style.transform = "";
    d.el.style.setProperty("--like", 0); d.el.style.setProperty("--nope", 0);
  }
  if (needRender) render();
}
document.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pid) endDrag(); });
document.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.pid) endDrag(); });
document.addEventListener("keydown", (e) => {
  if ($("view-pisos").hidden || tab !== "revisar" || document.querySelector("dialog[open]") || e.target.closest("input, textarea, select")) return;
  const top = document.querySelector("#view-pisos .swipe-card.top");
  if (!top) return;
  if (e.key === "ArrowRight") fly(top, 1);
  if (e.key === "ArrowLeft") fly(top, -1);
});

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-pisos")) return;
  const q = (s) => e.target.closest(s);
  if (q("[data-ptab]")) { tab = q("[data-ptab]").dataset.ptab; LS.set("bretona.pisotab", tab); render(); return; }
  if (q("#ps-sync")) return sync(true);
  if (q("#ps-new")) return openPiso(null);
  if (q("#ps-criteria")) return openCriteria();
  if (q("[data-swipe]")) { const top = document.querySelector("#view-pisos .swipe-card.top"); if (top) fly(top, q("[data-swipe]").dataset.swipe === "si" ? 1 : -1); return; }
  if (q("[data-undo]") && lastSwipe) {
    const p = pisos.find((x) => x.id === lastSwipe.id); const prev = lastSwipe.prev; lastSwipe = null;
    if (p) { p.votes = { ...(p.votes || {}) }; if (prev) p.votes[ctx.uid] = prev; else delete p.votes[ctx.uid]; render();
      ctx.F.updateDoc(subDoc("pisos", p.id), { ["votes." + ctx.uid]: prev || ctx.F.deleteField() }).catch(failed); }
    return;
  }
  const li = q(".piso"); if (!li) return;
  const p = pisos.find((x) => x.id === li.dataset.id); if (!p) return;
  if (q("[data-ps-edit]")) return openPiso(p);
  if (q("[data-feat]")) {
    // ? → Sí → No → ?   (y se recuerda que lo habéis puesto a mano)
    const f = q("[data-feat]").dataset.feat, cur = p[f];
    const next = cur === true ? false : cur === false ? null : true;
    p[f] = next; render();
    ctx.F.updateDoc(subDoc("pisos", p.id), { [f]: next, ["manual." + f]: true }).catch(failed);
    return;
  }
  const v = q("[data-vote]")?.dataset.vote;
  if (v) vote(p, v);
});

function openPiso(p) {
  editingId = p?.id || null;
  $("ps-title").textContent = p ? "Editar anuncio" : "Añadir anuncio";
  $("ps-url").value = p?.url || ""; $("ps-name").value = p?.title || "";
  $("ps-price").value = p?.price ? p.price.toLocaleString("es-ES") : ""; $("ps-rooms").value = p?.rooms || ""; $("ps-size").value = p?.size || "";
  $("ps-notes").value = p?.notes || ""; $("ps-msg").textContent = ""; $("ps-addr").value = p?.address || "";
  const tri = (v) => (v === true ? "si" : v === false ? "no" : "");
  $("ps-garage").value = tri(p?.garage); $("ps-storage").value = tri(p?.storage);
  $("ps-delete").hidden = !p;
  $("dlg-piso").showModal();
}
function portalOf(url) { const h = url.toLowerCase(); return h.includes("idealista") ? "idealista" : h.includes("fotocasa") ? "fotocasa" : h.includes("yaencontre") ? "yaencontre" : "otro"; }
$("ps-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const url = safeUrl($("ps-url").value.trim());
  if (!url) { e.preventDefault(); $("ps-msg").textContent = "Pega el enlace completo del anuncio (empieza por https://)."; return; }
  const num = (id) => { const n = parseEuro($(id).value); return n && n > 0 ? Math.round(n) : null; };
  const data = {
    url, portal: portalOf(url), title: cap($("ps-name").value).slice(0, 160) || "Anuncio de " + (PORTALS[portalOf(url)] || "piso"),
    price: num("ps-price"), rooms: num("ps-rooms"), size: num("ps-size"), notes: $("ps-notes").value.trim().slice(0, 1000),
    address: $("ps-addr").value.trim().slice(0, 160),
    garage: { si: true, no: false }[$("ps-garage").value] ?? null,
    storage: { si: true, no: false }[$("ps-storage").value] ?? null,
  };
  setTimeout(routes, 800);
  if (editingId) ctx.F.updateDoc(subDoc("pisos", editingId), { ...data, edited: true }).catch(failed);
  else {
    const id = safeId(data.portal + "-" + ((url.match(/(\d{6,})/) || [])[1] || Date.now()));
    if (pisos.some((p) => p.id === id)) { e.preventDefault(); $("ps-msg").textContent = "Ese anuncio ya está en la lista."; return; }
    ctx.F.setDoc(subDoc("pisos", id), { ...data, img: "", source: "manual", addedBy: ctx.uid, addedAt: Date.now(), mailDate: ymd() }).then(() => toast("Anuncio añadido")).catch(failed);
  }
  editingId = null;
});
$("ps-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("pisos", editingId)).catch(failed);
  editingId = null;
  $("dlg-piso").close();
});

$("cr-reread").addEventListener("click", () => { $("dlg-criteria").close(); reread(); });
function openCriteria() {
  const c = criteria();
  $("cr-min").value = c.maxMinutes || ""; $("cr-hour").value = c.hour || "08:30";
  $("cr-trash").checked = c.trashMails !== false;
  $("cr-price").value = c.maxPrice ? c.maxPrice.toLocaleString("es-ES") : ""; $("cr-rooms").value = c.minRooms || "";
  $("cr-size").value = c.minSize || ""; $("cr-words").value = c.words || "";
  $("dlg-criteria").showModal();
}
$("cr-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const num = (id) => { const n = parseEuro($(id).value); return n && n > 0 ? Math.round(n) : null; };
  ctx.F.updateDoc(houseRef(), { pisoCriteria: { maxPrice: num("cr-price"), minRooms: num("cr-rooms"), minSize: num("cr-size"), words: $("cr-words").value.trim().slice(0, 200), maxMinutes: num("cr-min"), hour: $("cr-hour").value || "08:30", trashMails: $("cr-trash").checked } })
    .then(() => { toast("Criterios guardados"); setTimeout(routes, 500); }).catch(failed);
});
