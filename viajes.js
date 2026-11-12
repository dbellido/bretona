// Pestaña Viajes: cada viaje con sus reservas y el plan de cada día.
import {
  ctx, $, esc, cap, toast, failed, sub, subDoc, uidShort,
  ymd, addDays, daysBetween, fmtDay, fmtDayLong, fmtDate, relDay, calLink, mapsLink, safeUrl,
} from "./core.js";

let trips = [], unsub = null;
let openId = null;          // viaje abierto
let tab = "reservas";       // reservas | itinerario
let editing = null;         // { kind, id, day }

const TYPES = {
  vuelo: { label: "Vuelo", icon: '<path d="M2.5 13.5l7-2 4-7.5 1.8.4-1.6 7 5.3-1.4 1.5-2.2 1.4.3-.8 3.6.8 3.6-1.4.3-1.5-2.2-5.3-1.4 1.6 7-1.8.4-4-7.5-7-2z" fill="currentColor"/>' },
  tren: { label: "Tren / bus", icon: '<rect x="6" y="3" width="12" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 11h12M9 21l1.5-3M15 21l-1.5-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9.5" cy="14" r="1" fill="currentColor"/><circle cx="14.5" cy="14" r="1" fill="currentColor"/>' },
  hotel: { label: "Alojamiento", icon: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="11" r="2" fill="currentColor"/>' },
  coche: { label: "Coche", icon: '<path d="M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v2M20 16v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.5" cy="13.5" r="1" fill="currentColor"/><circle cx="16.5" cy="13.5" r="1" fill="currentColor"/>' },
  actividad: { label: "Entradas / actividad", icon: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 7v10" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2"/>' },
  otro: { label: "Otro", icon: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="12" r="1.2" fill="currentColor"/>' },
};
const icon = (t) => `<svg class="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">${(TYPES[t] || TYPES.otro).icon}</svg>`;

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-trip" class="sheet">
  <form method="dialog" id="tr-form">
    <h2 id="tr-title">Nuevo viaje</h2>
    <label class="field"><span>Nombre del viaje</span><input id="tr-name" maxlength="50" placeholder="Verano en Asturias" required></label>
    <label class="field"><span>Destino</span><input id="tr-dest" maxlength="60" placeholder="Llanes, Asturias"></label>
    <div class="row">
      <label class="field"><span>Ida</span><input id="tr-start" type="date" required></label>
      <label class="field"><span>Vuelta</span><input id="tr-end" type="date" required></label>
    </div>
    <label class="field"><span>Notas</span><textarea id="tr-notes" rows="3" maxlength="1000" placeholder="Quién va, qué hay que preparar…"></textarea></label>
    <p class="note" id="tr-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="tr-delete" hidden>Borrar viaje</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
    <div class="confirm" id="tr-del-confirm" hidden>¿Borrar el viaje con todas sus reservas? <button class="btn danger-btn" type="button" id="tr-del-yes">Borrar</button><button class="link" type="button" id="tr-del-no">Cancelar</button></div>
  </form>
</dialog>

<dialog id="dlg-booking" class="sheet">
  <form method="dialog" id="bk-form">
    <h2 id="bk-title">Nueva reserva</h2>
    <div class="row">
      <label class="field"><span>Tipo</span><select id="bk-type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select></label>
      <label class="field"><span>Localizador</span><input id="bk-ref" maxlength="40" placeholder="ABC123" autocapitalize="characters"></label>
    </div>
    <label class="field"><span>Qué es</span><input id="bk-name" maxlength="80" placeholder="Vuelo Madrid → Oviedo, Iberia IB1234" required></label>
    <div class="row">
      <label class="field"><span>Fecha</span><input id="bk-date" type="date"></label>
      <label class="field"><span>Hora</span><input id="bk-time" type="time"></label>
    </div>
    <div class="row" id="bk-end-row">
      <label class="field"><span id="bk-end-label">Hasta</span><input id="bk-end" type="date"></label>
      <label class="field"><span>Hora</span><input id="bk-end-time" type="time"></label>
    </div>
    <label class="field"><span>Dirección</span><input id="bk-addr" maxlength="120" placeholder="Para abrirla en el mapa"></label>
    <label class="field"><span>Enlace</span><input id="bk-link" type="url" maxlength="500" placeholder="https://… (la reserva, la tarjeta de embarque)"></label>
    <label class="field"><span>Notas</span><textarea id="bk-notes" rows="2" maxlength="600" placeholder="Asientos, maletas, check-in…"></textarea></label>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="bk-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-plan" class="sheet">
  <form method="dialog" id="pl-form">
    <h2 id="pl-title">Añadir al plan</h2>
    <div class="row">
      <label class="field"><span>Día</span><select id="pl-day"></select></label>
      <label class="field" style="flex:0 0 120px"><span>Hora</span><input id="pl-time" type="time"></label>
    </div>
    <label class="field"><span>Qué hacer</span><input id="pl-text" maxlength="120" placeholder="Playa de Torimbia, comer en Casa Pilar…" required></label>
    <label class="field"><span>Lugar (opcional)</span><input id="pl-place" maxlength="120" placeholder="Para abrirlo en el mapa"></label>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="pl-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("trips"), (s) => {
    trips = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (openId && !trips.some((t) => t.id === openId)) openId = null;
    render();
  }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; trips = []; openId = null; }
export function onShow() { render(); }
export const getTrips = () => trips;
export const TYPE_ICON = (t) => icon(t);
export const openTripById = (id) => { openId = id; tab = "reservas"; render(); };

const trip = () => trips.find((t) => t.id === openId);
const tripDays = (t) => {
  const n = Math.min(Math.max(daysBetween(t.start, t.end || t.start), 0), 60);
  return Array.from({ length: n + 1 }, (_, i) => addDays(t.start, i));
};
function tripWhen(t) {
  const today = ymd();
  if (today < t.start) return relDay(t.start);
  if (today <= (t.end || t.start)) return `De viaje · día ${daysBetween(t.start, today) + 1}`;
  return "";
}

function render() {
  const root = $("view-viajes");
  if (!root || !ctx.hid) return;
  const t = trip();
  root.innerHTML = t ? detailHtml(t) : listHtml();
}

function listHtml() {
  const today = ymd();
  const upcoming = trips.filter((t) => (t.end || t.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const past = trips.filter((t) => (t.end || t.start) < today).sort((a, b) => b.start.localeCompare(a.start));
  const card = (t) => `
    <li><button class="trip-card" data-trip="${esc(t.id)}">
      <span class="trip-dates"><b>${esc(fmtDay(t.start))}</b>${t.end && t.end !== t.start ? ` – ${esc(fmtDay(t.end))}` : ""}</span>
      <span class="trip-name">${esc(t.name)}</span>
      ${t.dest ? `<span class="muted">${esc(t.dest)}</span>` : ""}
      <span class="trip-foot">${tripWhen(t) ? `<span class="pill">${esc(tripWhen(t))}</span>` : ""}
        <span class="muted">${(t.bookings || []).length} ${(t.bookings || []).length === 1 ? "reserva" : "reservas"} · ${(t.plans || []).length} en el plan</span></span>
    </button></li>`;
  return `
    <div class="view-head"><h1>Viajes</h1><button class="btn" id="v-new">Nuevo viaje</button></div>
    <div class="mail-row">
      <button class="btn ghost" id="v-mail"${ctx.house?.calendarFeed ? "" : " disabled"}>Buscar reservas en el correo</button>
      <span class="muted small-print">${ctx.house?.calendarFeed ? "Vuelos, trenes, hoteles y coches de alquiler de los últimos 6 meses." : "Conecta primero el programa de Google (pestaña Calendario)."}</span>
    </div>
    ${!trips.length ? `<div class="empty"><strong>Ningún viaje todavía</strong>Crea uno y guardad juntos los vuelos, el hotel y el plan de cada día.</div>` : ""}
    ${upcoming.length ? `<section class="panel plain"><h2>Próximos</h2><ul class="trip-list">${upcoming.map(card).join("")}</ul></section>` : ""}
    ${past.length ? `<section class="panel plain"><h2>Anteriores</h2><ul class="trip-list past">${past.map(card).join("")}</ul></section>` : ""}`;
}

function bookingHtml(b) {
  const when = [b.date && fmtDay(b.date), b.time].filter(Boolean).join(" · ");
  const until = b.end ? ` → ${fmtDay(b.end)}${b.endTime ? " · " + b.endTime : ""}` : "";
  const link = safeUrl(b.link);
  return `<li class="booking">
    <span class="bk-ico">${icon(b.type)}</span>
    <div class="bk-body">
      <span class="bk-when">${esc(when)}${esc(until)}</span>
      <span class="bk-name">${esc(b.name)}</span>
      ${b.ref ? `<span class="bk-ref">Localizador <code>${esc(b.ref)}</code> <button class="link small" data-copy="${esc(b.ref)}">Copiar</button></span>` : ""}
      ${b.notes ? `<span class="bk-notes">${esc(b.notes)}</span>` : ""}
      <span class="bk-links">
        ${b.addr ? `<a href="${esc(mapsLink(b.addr))}" target="_blank" rel="noopener">Mapa</a>` : ""}
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Abrir enlace</a>` : ""}
        ${b.date ? `<a href="${esc(calLink({ title: b.name, date: b.date, time: b.time, endDate: b.end, endTime: b.endTime, details: [b.ref && "Localizador: " + b.ref, b.notes].filter(Boolean).join("\n"), location: b.addr || "" }))}" target="_blank" rel="noopener">Al calendario</a>` : ""}
      </span>
    </div>
    <button class="more" data-booking="${esc(b.id)}" aria-label="Editar ${esc(b.name)}">•••</button>
  </li>`;
}

function detailHtml(t) {
  const bookings = [...(t.bookings || [])].sort((a, b) => ((a.date || "9") + (a.time || "")).localeCompare((b.date || "9") + (b.time || "")));
  const days = tripDays(t);
  const plans = t.plans || [];
  const itinerary = days.map((d, i) => {
    const entries = [
      ...plans.filter((p) => p.day === d).map((p) => ({ ...p, kind: "plan" })),
      ...bookings.filter((b) => b.date === d).map((b) => ({ id: b.id, time: b.time, text: b.name, kind: "booking", type: b.type })),
      ...bookings.filter((b) => b.type === "hotel" && b.end === d).map((b) => ({ id: b.id, time: b.endTime, text: "Salida: " + b.name, kind: "booking", type: b.type })),
    ].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
    return `<section class="day">
      <h3><span class="day-n">Día ${i + 1}</span> ${esc(fmtDayLong(d))}${d === ymd() ? ' <span class="pill">Hoy</span>' : ""}</h3>
      <ul class="plan">${entries.map((e) => e.kind === "plan"
        ? `<li><button class="plan-item" data-plan="${esc(e.id)}"><span class="plan-time">${esc(e.time || "")}</span><span>${esc(e.text)}${e.place ? `<small>${esc(e.place)}</small>` : ""}</span></button>${e.place ? `<a class="plan-map" href="${esc(mapsLink(e.place))}" target="_blank" rel="noopener" aria-label="Ver en el mapa">Mapa</a>` : ""}</li>`
        : `<li class="from-booking"><span class="plan-time">${esc(e.time || "")}</span>${icon(e.type)}<span>${esc(e.text)}</span></li>`).join("")}
      </ul>
      <button class="link small" data-add-plan="${d}">+ Añadir</button>
    </section>`;
  }).join("");

  return `
    <div class="detail-top">
      <button class="link" id="v-back">‹ Viajes</button>
      <button class="link" id="v-edit">Editar</button>
    </div>
    <div class="trip-hero">
      <span class="trip-dates"><b>${esc(fmtDate(t.start))}</b>${t.end && t.end !== t.start ? ` – ${esc(fmtDate(t.end))}` : ""} · ${days.length} ${days.length === 1 ? "día" : "días"}</span>
      <h1>${esc(t.name)}</h1>
      ${t.dest ? `<a class="muted" href="${esc(mapsLink(t.dest))}" target="_blank" rel="noopener">${esc(t.dest)}</a>` : ""}
      <div class="trip-foot">${tripWhen(t) ? `<span class="pill">${esc(tripWhen(t))}</span>` : ""}
        <a class="link small" href="${esc(calLink({ title: t.name, date: t.start, endDate: t.end, details: t.dest || "", location: t.dest || "" }))}" target="_blank" rel="noopener">Añadir al calendario</a></div>
      ${t.notes ? `<p class="trip-notes">${esc(t.notes)}</p>` : ""}
    </div>
    <div class="seg wide" role="tablist">
      <button role="tab" data-ttab="reservas" aria-selected="${tab === "reservas"}">Reservas · ${bookings.length}</button>
      <button role="tab" data-ttab="itinerario" aria-selected="${tab === "itinerario"}">Itinerario</button>
    </div>
    ${tab === "reservas" ? `
      ${bookings.length ? `<ul class="bookings">${bookings.map(bookingHtml).join("")}</ul>` : `<p class="muted">Guarda aquí vuelos, trenes, alojamiento, coche de alquiler o entradas, con su localizador y su enlace.</p>`}
      <button class="btn wide" id="v-add-booking">Añadir reserva</button>`
    : `<div class="itinerary">${itinerary}</div>`}`;
}

/* ---------- Guardar ---------- */
async function saveTrip(data) {
  try {
    if (editing?.id) await ctx.F.updateDoc(subDoc("trips", editing.id), data);
    else { const r = await ctx.F.addDoc(sub("trips"), { ...data, bookings: [], plans: [], createdAt: Date.now(), addedBy: ctx.uid }); openId = r.id; tab = "reservas"; render(); }
  } catch (e) { failed(e); }
}
function saveList(field, list) {
  ctx.F.updateDoc(subDoc("trips", openId), { [field]: list }).catch(failed);
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#view-viajes")) return;
  const q = (s) => e.target.closest(s);
  if (q("#v-new")) return openTrip(null);
  if (q("#v-back")) { openId = null; render(); return; }
  if (q("#v-edit")) return openTrip(trip());
  if (q("[data-trip]")) { openId = q("[data-trip]").dataset.trip; tab = "reservas"; render(); window.scrollTo(0, 0); return; }
  if (q("[data-ttab]")) { tab = q("[data-ttab]").dataset.ttab; render(); return; }
  if (q("#v-add-booking")) return openBooking(null);
  if (q("[data-booking]")) return openBooking((trip().bookings || []).find((b) => b.id === q("[data-booking]").dataset.booking));
  if (q("[data-add-plan]")) return openPlan(null, q("[data-add-plan]").dataset.addPlan);
  if (q("[data-plan]")) return openPlan((trip().plans || []).find((p) => p.id === q("[data-plan]").dataset.plan));
  if (q("[data-copy]")) {
    const v = q("[data-copy]").dataset.copy;
    try { await navigator.clipboard.writeText(v); toast("Localizador copiado"); } catch { toast(v, 6000); }
  }
});

// Viaje
function openTrip(t) {
  editing = { kind: "trip", id: t?.id || null };
  $("tr-title").textContent = t ? "Editar viaje" : "Nuevo viaje";
  $("tr-name").value = t?.name || ""; $("tr-dest").value = t?.dest || "";
  $("tr-start").value = t?.start || ""; $("tr-end").value = t?.end || "";
  $("tr-notes").value = t?.notes || ""; $("tr-msg").textContent = "";
  $("tr-delete").hidden = !t; $("tr-del-confirm").hidden = true;
  $("dlg-trip").showModal();
}
$("tr-start").addEventListener("change", () => { if (!$("tr-end").value || $("tr-end").value < $("tr-start").value) $("tr-end").value = $("tr-start").value; });
$("tr-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const start = $("tr-start").value, end = $("tr-end").value || start;
  if (end < start) { e.preventDefault(); $("tr-msg").textContent = "La vuelta no puede ser antes de la ida."; return; }
  if (daysBetween(start, end) > 60) { e.preventDefault(); $("tr-msg").textContent = "Un viaje puede durar como mucho 60 días."; return; }
  saveTrip({ name: cap($("tr-name").value).slice(0, 50), dest: cap($("tr-dest").value).slice(0, 60), start, end, notes: $("tr-notes").value.trim().slice(0, 1000) });
});
$("tr-delete").addEventListener("click", () => { $("tr-del-confirm").hidden = false; });
$("tr-del-no").addEventListener("click", () => { $("tr-del-confirm").hidden = true; });
$("tr-del-yes").addEventListener("click", () => {
  if (editing?.id) ctx.F.deleteDoc(subDoc("trips", editing.id)).catch(failed);
  openId = null; $("dlg-trip").close(); render();
});

// Reserva
function openBooking(b) {
  editing = { kind: "booking", id: b?.id || null };
  const t = trip();
  $("bk-title").textContent = b ? "Editar reserva" : "Nueva reserva";
  $("bk-type").value = b?.type || "vuelo"; $("bk-ref").value = b?.ref || ""; $("bk-name").value = b?.name || "";
  $("bk-date").value = b?.date || t.start; $("bk-time").value = b?.time || "";
  $("bk-end").value = b?.end || ""; $("bk-end-time").value = b?.endTime || "";
  $("bk-addr").value = b?.addr || ""; $("bk-link").value = b?.link || ""; $("bk-notes").value = b?.notes || "";
  $("bk-delete").hidden = !b;
  syncBookingType();
  $("dlg-booking").showModal();
}
function syncBookingType() {
  const ty = $("bk-type").value;
  $("bk-end-label").textContent = ty === "hotel" ? "Salida" : ty === "coche" ? "Devolución" : "Llegada";
  if (ty === "hotel" && !$("bk-end").value && trip()) $("bk-end").value = trip().end;
}
$("bk-type").addEventListener("change", syncBookingType);
$("bk-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const data = {
    id: editing.id || uidShort(), type: $("bk-type").value, name: cap($("bk-name").value).slice(0, 80),
    ref: $("bk-ref").value.trim().toUpperCase().slice(0, 40), date: $("bk-date").value, time: $("bk-time").value,
    end: $("bk-end").value, endTime: $("bk-end-time").value, addr: $("bk-addr").value.trim().slice(0, 120),
    link: safeUrl($("bk-link").value.trim()) ? $("bk-link").value.trim().slice(0, 500) : "", notes: $("bk-notes").value.trim().slice(0, 600),
  };
  const list = [...(trip().bookings || [])];
  const i = list.findIndex((x) => x.id === data.id);
  if (i >= 0) list[i] = data; else list.push(data);
  saveList("bookings", list);
});
$("bk-delete").addEventListener("click", () => {
  saveList("bookings", (trip().bookings || []).filter((x) => x.id !== editing.id));
  $("dlg-booking").close();
});

// Plan del día
function openPlan(p, day) {
  editing = { kind: "plan", id: p?.id || null };
  const t = trip();
  const d = p?.day || day || t.start;
  $("pl-title").textContent = p ? "Editar plan" : "Añadir al plan";
  $("pl-day").innerHTML = tripDays(t).map((x, i) => `<option value="${x}"${x === d ? " selected" : ""}>Día ${i + 1} · ${esc(fmtDay(x))}</option>`).join("");
  $("pl-time").value = p?.time || ""; $("pl-text").value = p?.text || ""; $("pl-place").value = p?.place || "";
  $("pl-delete").hidden = !p;
  $("dlg-plan").showModal();
}
$("pl-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const data = { id: editing.id || uidShort(), day: $("pl-day").value, time: $("pl-time").value, text: cap($("pl-text").value).slice(0, 120), place: $("pl-place").value.trim().slice(0, 120) };
  const list = [...(trip().plans || [])];
  const i = list.findIndex((x) => x.id === data.id);
  if (i >= 0) list[i] = data; else list.push(data);
  saveList("plans", list);
});
$("pl-delete").addEventListener("click", () => {
  saveList("plans", (trip().plans || []).filter((x) => x.id !== editing.id));
  $("dlg-plan").close();
});
