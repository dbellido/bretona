// Pestaña Pisos (beta): anuncios de las alertas de Idealista, Fotocasa y Yaencontre,
// leídos del correo por el programa de Google. Cada miembro vota; si todos dicen que sí, pasa a Favoritos.
import {
  ctx, $, esc, cap, norm, toast, failed, sub, subDoc, houseRef, memberName,
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
  }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; pisos = []; }
export function onShow() { render(); sync().then(() => routes()); }
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
  const url = ctx.house?.calendarFeed;
  if (!url || syncing || (!force && Date.now() - lastSync < 10 * 60000)) return;
  syncing = true; syncMsg = ""; render();
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "tipo=pisos", { redirect: "follow" });
    const data = await r.json();
    if (!Array.isArray(data.pisos)) throw new Error(data.error || "sin pisos");
    const known = new Set(pisos.map((p) => p.id));
    const fresh = data.pisos.filter((a) => a && a.id && !known.has(safeId(a.id)));
    for (let i = 0; i < fresh.length; i += 400) {
      const b = ctx.F.writeBatch(ctx.fs);
      for (const a of fresh.slice(i, i + 400)) {
        b.set(subDoc("pisos", safeId(a.id)), {
          portal: PORTALS[a.portal] ? a.portal : "otro", url: safeUrl(a.url) || "", title: cap(a.titulo || a.asunto || "Anuncio").slice(0, 160),
          price: Number(a.precio) || null, rooms: Number(a.habitaciones) || null, size: Number(a.m2) || null,
          img: safeUrl(a.foto) || "", place: String(a.zona || "").slice(0, 120), mailDate: String(a.fecha || "").slice(0, 10),
          source: "alerta", addedAt: Date.now(),
        }, { merge: true });
      }
      await b.commit();
    }
    lastSync = Date.now();
    setTimeout(routes, 500);
    syncMsg = fresh.length ? `${fresh.length} ${fresh.length === 1 ? "anuncio nuevo" : "anuncios nuevos"}` : "";
  } catch (e) {
    console.error(e);
    syncMsg = /sin pisos/.test(e.message) ? "El programa de Google aún no sabe leer las alertas. Actualízalo con el texto nuevo (te lo da Claude)." : "No se han podido leer las alertas ahora.";
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
let routing = false;
async function routes() {
  const url = ctx.house?.calendarFeed;
  if (!url || routing) return;
  const c = criteria();
  const todo = pisos.filter((p) => status(p) !== "descartados" && originOf(p) &&
    (!p.transit || p.transit.query !== originOf(p) + "|" + c.hour) && !(p.transit?.failedAt > Date.now() - 86400000 && p.transit.query === originOf(p) + "|" + c.hour)).slice(0, 12);
  if (!todo.length) return;
  routing = true; render();
  for (const p of todo) {
    const q = originOf(p);
    try {
      const r = await fetch(url + (url.includes("?") ? "&" : "?") + "tipo=ruta&hora=" + encodeURIComponent(c.hour) + "&origen=" + encodeURIComponent(q), { redirect: "follow" });
      const d = await r.json();
      if (d.mejor) await ctx.F.updateDoc(subDoc("pisos", p.id), { transit: { min: d.mejor.min, dest: d.mejor.destino, all: d.tiempos || {}, from: String(d.desde || "").slice(0, 160), query: q + "|" + c.hour, at: Date.now() } });
      else if (d.error === "sin ruta") await ctx.F.updateDoc(subDoc("pisos", p.id), { transit: { query: q + "|" + c.hour, failedAt: Date.now() } });
      else { syncMsg = "Actualiza el programa de Google para calcular trayectos (te lo explica Claude)."; break; }
    } catch (e) { console.error(e); break; }
  }
  routing = false; render();
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
  return routing ? `<span class="muted small-print"><span class="spinner"></span>Calculando trayecto…</span>` : "";
}
function card(p, ppl) {
  const mine = (p.votes || {})[ctx.uid];
  const facts = [p.rooms && `${p.rooms} hab.`, p.size && `${p.size} m²`, p.price && p.size && `${Math.round(p.price / p.size).toLocaleString("es-ES")} €/m²`].filter(Boolean).join(" · ");
  const url = safeUrl(p.url);
  return `<li class="piso" data-id="${esc(p.id)}">
    ${p.img ? `<img class="piso-img" src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div class="piso-body">
      <div class="piso-top"><span class="portal portal-${esc(p.portal)}">${esc(PORTALS[p.portal] || "Otro")}</span>${p.mailDate ? `<span class="muted">${esc(fmtDate(p.mailDate))}</span>` : ""}</div>
      ${p.price ? `<span class="piso-price">${euro(p.price).replace(",00", "")}</span>` : ""}
      <span class="piso-title">${esc(p.title)}</span>
      ${facts || p.place ? `<span class="muted">${esc([facts, p.place].filter(Boolean).join(" · "))}</span>` : ""}
      ${transitHtml(p)}
      ${p.notes ? `<span class="piso-notes">${esc(p.notes)}</span>` : ""}
      <div class="piso-foot">
        ${votesHtml(p, ppl)}
        <span class="piso-links">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Ver anuncio</a>` : ""}<button class="more" data-ps-edit aria-label="Editar">•••</button></span>
      </div>
      <div class="vote-btns">
        <button class="btn${mine === "si" ? "" : " ghost"}" data-vote="si">${mine === "si" ? "Me gusta ✓" : "Me gusta"}</button>
        <button class="btn${mine === "no" ? " danger-btn" : " ghost"}" data-vote="no">${mine === "no" ? "No ✕" : "No"}</button>
      </div>
    </div>
  </li>`;
}

function render() {
  const root = $("view-pisos");
  if (!root || !ctx.hid) return;
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
      <span class="muted">${syncing ? '<span class="spinner"></span>Leyendo alertas…' : routing ? '<span class="spinner"></span>Calculando trayectos…' : esc(syncMsg || (configured ? "Anuncios de las alertas de idealista, Fotocasa y yaencontré" : ""))}</span>
      <span>${configured ? `<button class="link small" id="ps-sync">Actualizar</button> · ` : ""}<button class="link small" id="ps-criteria">Criterios</button></span>
    </div>
    <div class="seg wide" role="tablist">
      <button role="tab" data-ptab="revisar" aria-selected="${tab === "revisar"}">Por revisar · ${groups.revisar.length}</button>
      <button role="tab" data-ptab="favoritos" aria-selected="${tab === "favoritos"}">Favoritos · ${groups.favoritos.length}</button>
      <button role="tab" data-ptab="descartados" aria-selected="${tab === "descartados"}">Descartados</button>
    </div>
    ${list.length ? `<ul class="pisos">${list.map((p) => card(p, ppl)).join("")}</ul>` : `<div class="empty">${tab === "revisar"
      ? `<strong>Nada por revisar</strong>${configured ? "Cuando lleguen anuncios de vuestras alertas aparecerán aquí." : "Conecta el programa de Google en la pestaña Calendario para leer las alertas de los portales, o añade anuncios a mano."}`
      : tab === "favoritos" ? `<strong>Aún no hay favoritos</strong>Un piso pasa aquí cuando ${others.length ? "tú y " + others.join(" y ") + " le dais a «Me gusta»" : "todos le dais a «Me gusta»"}.`
      : `<strong>Nada descartado</strong>Basta con que alguien diga «No» para que un piso venga aquí.`}</div>`}
    ${groups.fuera.length && tab !== "fuera" ? `<button class="link small" data-ptab="fuera">Ver los que no cumplen los criterios (${groups.fuera.length})</button>` : ""}
    ${tab === "fuera" ? `<button class="link small" data-ptab="revisar">‹ Volver</button>` : ""}`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-pisos")) return;
  const q = (s) => e.target.closest(s);
  if (q("[data-ptab]")) { tab = q("[data-ptab]").dataset.ptab; LS.set("bretona.pisotab", tab); render(); return; }
  if (q("#ps-sync")) return sync(true);
  if (q("#ps-new")) return openPiso(null);
  if (q("#ps-criteria")) return openCriteria();
  const li = q(".piso"); if (!li) return;
  const p = pisos.find((x) => x.id === li.dataset.id); if (!p) return;
  if (q("[data-ps-edit]")) return openPiso(p);
  const v = q("[data-vote]")?.dataset.vote;
  if (v) {
    const cur = (p.votes || {})[ctx.uid];
    const next = cur === v ? ctx.F.deleteField() : v;
    ctx.F.updateDoc(subDoc("pisos", p.id), { ["votes." + ctx.uid]: next }).then(() => {
      const after = { ...(p.votes || {}), [ctx.uid]: cur === v ? undefined : v };
      if (v === "si" && cur !== v && deciders().every((m) => after[m] === "si")) toast("¡Piso en favoritos! Os gusta a todos");
    }).catch(failed);
  }
});

function openPiso(p) {
  editingId = p?.id || null;
  $("ps-title").textContent = p ? "Editar anuncio" : "Añadir anuncio";
  $("ps-url").value = p?.url || ""; $("ps-name").value = p?.title || "";
  $("ps-price").value = p?.price ? p.price.toLocaleString("es-ES") : ""; $("ps-rooms").value = p?.rooms || ""; $("ps-size").value = p?.size || "";
  $("ps-notes").value = p?.notes || ""; $("ps-msg").textContent = ""; $("ps-addr").value = p?.address || "";
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
  };
  setTimeout(routes, 800);
  if (editingId) ctx.F.updateDoc(subDoc("pisos", editingId), data).catch(failed);
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

function openCriteria() {
  const c = criteria();
  $("cr-min").value = c.maxMinutes || ""; $("cr-hour").value = c.hour || "08:30";
  $("cr-price").value = c.maxPrice ? c.maxPrice.toLocaleString("es-ES") : ""; $("cr-rooms").value = c.minRooms || "";
  $("cr-size").value = c.minSize || ""; $("cr-words").value = c.words || "";
  $("dlg-criteria").showModal();
}
$("cr-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const num = (id) => { const n = parseEuro($(id).value); return n && n > 0 ? Math.round(n) : null; };
  ctx.F.updateDoc(houseRef(), { pisoCriteria: { maxPrice: num("cr-price"), minRooms: num("cr-rooms"), minSize: num("cr-size"), words: $("cr-words").value.trim().slice(0, 200), maxMinutes: num("cr-min"), hour: $("cr-hour").value || "08:30" } })
    .then(() => { toast("Criterios guardados"); setTimeout(routes, 500); }).catch(failed);
});
