// Viajes: buscar en el correo las confirmaciones de reservas (vuelos, trenes, hoteles, coches…)
// y añadirlas a los viajes después de revisarlas.
import { ctx, $, esc, cap, norm, toast, failed, sub, subDoc, uidShort, ymd, addDays, daysBetween, fmtDay, callScript, CLAVE_MSG, askGemini } from "./core.js";
import { getTrips, TYPE_ICON, openTripById } from "./viajes.js";

let found = [];      // reservas encontradas, pendientes de revisar
let mails = [];      // correos de esta búsqueda (para marcarlos como revisados)
let busy = false;

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-mail" class="sheet">
  <div class="sheet-head"><h2>Reservas encontradas</h2><button class="icon-btn" id="ml-close" aria-label="Cerrar">×</button></div>
  <p class="muted small-print" id="ml-intro"></p>
  <ul class="mail-list" id="ml-list"></ul>
  <div class="sheet-actions">
    <button class="link small" type="button" id="ml-ignore">Ignorar estas</button>
    <span class="spacer"></span>
    <button class="btn" id="ml-add" type="button">Añadir</button>
  </div>
</dialog>`);

const TYPES = ["vuelo", "tren", "hotel", "coche", "actividad", "otro"];
const TYPE_LABEL = { vuelo: "Vuelo", tren: "Tren / bus", hotel: "Alojamiento", coche: "Coche", actividad: "Actividad", otro: "Otro" };

function promptFor(chunk) {
  return `Organizas los viajes de una familia en España. Hoy es ${ymd()}.
Abajo hay correos. Para cada correo que sea una CONFIRMACIÓN de una reserva real (vuelo, tren, autobús, hotel o apartamento, coche de alquiler, entradas o actividad), extrae las reservas.
NO incluyas: publicidad, ofertas, newsletters, encuestas, reservas canceladas, ni avisos que no traigan datos de la reserva.
Un correo puede tener varias reservas (por ejemplo, ida y vuelta son 2 vuelos; cada trayecto de tren por separado).
Responde SOLO con JSON con esta forma exacta:
{"reservas":[{"correo":"ID del correo","tipo":"vuelo","titulo":"Vuelo Madrid → Oviedo · Iberia IB1234","fecha":"2026-12-04","hora":"08:15","fechaFin":"2026-12-04","horaFin":"09:20","localizador":"XK7P2Q","direccion":"","destino":"Oviedo","notas":"2 pasajeros, maleta de cabina"}]}
Reglas:
- "tipo": uno de ${TYPES.join(", ")}.
- "titulo": corto y claro, con origen → destino y número de vuelo o tren, o el nombre del hotel.
- "fecha"/"hora": salida (transporte), entrada (hotel) o recogida (coche). "fechaFin"/"horaFin": llegada, salida del hotel o devolución. Formato AAAA-MM-DD y HH:MM, hora local. "" si no aparece.
- "destino": la ciudad o zona a la que se viaja (para un hotel, su ciudad).
- "direccion": la del hotel, estación o recogida del coche, si aparece.
- "notas": breve (pasajeros, asientos, equipaje, régimen…). No copies datos de pago.
- Si un correo no tiene reservas válidas, no pongas nada para él.

${chunk.map((c) => `=== CORREO ID: ${c.id} | recibido ${c.fecha} | de: ${c.de} | asunto: ${c.asunto}
${c.datos ? "DATOS ESTRUCTURADOS: " + c.datos.slice(0, 3000) + "\n" : ""}TEXTO: ${c.texto.slice(0, 4000)}`).join("\n\n")}`;
}

function cleanBooking(r) {
  const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "";
  const okTime = (t) => /^\d{2}:\d{2}$/.test(t || "") ? t : "";
  return {
    mailId: String(r.correo || ""), type: TYPES.includes(r.tipo) ? r.tipo : "otro",
    name: cap(r.titulo || TYPE_LABEL[r.tipo] || "Reserva").slice(0, 80),
    date: okDate(r.fecha), time: okTime(r.hora), end: okDate(r.fechaFin), endTime: okTime(r.horaFin),
    ref: String(r.localizador || "").toUpperCase().slice(0, 40), addr: String(r.direccion || "").slice(0, 120),
    dest: cap(r.destino || "").slice(0, 60), notes: String(r.notas || "").slice(0, 600),
  };
}

// ¿Ya está esta reserva en algún viaje?
function alreadyIn(b) {
  for (const t of getTrips()) for (const x of t.bookings || []) {
    if (b.ref && x.ref && x.ref === b.ref && x.date === b.date && x.type === b.type) return t;
    if (x.date === b.date && norm(x.name) === norm(b.name)) return t;
  }
  return null;
}
// Viaje que encaja por fechas (con un par de días de margen).
function matchTrip(b) {
  if (!b.date) return null;
  return getTrips().find((t) => b.date >= addDays(t.start, -3) && b.date <= addDays(t.end || t.start, 2)) || null;
}

async function scan() {
  if (busy) return;
  busy = true;
  const btn = $("v-mail"); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Buscando en el correo…'; }
  try {
    const data = await callScript({ tipo: "reservas" });
    if (!Array.isArray(data.correos)) throw new Error("viejo");
    let seen = new Set();
    try { seen = new Set((await ctx.F.getDocs(sub("mailseen"))).docs.map((d) => d.id)); } catch {}
    mails = data.correos.filter((c) => c && c.id && !seen.has(safe(c.id)));
    if (!mails.length) { toast("No hay reservas nuevas en el correo"); return; }
    const results = [];
    for (let i = 0; i < mails.length; i += 5) {
      if (btn) btn.innerHTML = `<span class="spinner"></span>Leyendo correos… ${Math.min(i + 5, mails.length)} de ${mails.length}`;
      const d = await askGemini(promptFor(mails.slice(i, i + 5)), null, { temperature: 0.1 });
      results.push(...(Array.isArray(d) ? d : d?.reservas || []));
    }
    found = results.map(cleanBooking).filter((b) => b.date && mails.some((m) => m.id === b.mailId));
    // Correos sin ninguna reserva: se marcan como revisados para no volver a leerlos.
    const empty = mails.filter((m) => !found.some((b) => b.mailId === m.id));
    if (empty.length) {
      const b = ctx.F.writeBatch(ctx.fs);
      empty.forEach((m) => b.set(subDoc("mailseen", safe(m.id)), { result: "none", at: Date.now() }));
      b.commit().catch(() => {});
    }
    if (!found.length) { toast(`He revisado ${mails.length} ${mails.length === 1 ? "correo" : "correos"} y no hay reservas nuevas`); return; }
    openReview();
  } catch (e) {
    console.error(e);
    toast(e.message === "clave" ? CLAVE_MSG : e.message === "viejo" ? "Actualiza el programa de Google para leer reservas (te lo explica Claude)." : e.message || "No se ha podido leer el correo.", 7000);
  } finally {
    busy = false;
    const b2 = $("v-mail"); if (b2) { b2.disabled = false; b2.textContent = "Buscar reservas en el correo"; }
  }
}
const safe = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);

/* ---------- Revisar ---------- */
function openReview() {
  found.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // Agrupar las que no encajan en ningún viaje en viajes nuevos (reservas a menos de 5 días entre sí).
  let group = 0, last = null;
  for (const b of found) {
    b.dup = alreadyIn(b);
    b.on = !b.dup;
    const t = matchTrip(b);
    if (t) { b.target = t.id; continue; }
    if (!last || daysBetween(last, b.date) > 5) group++;
    last = b.end || b.date;
    b.target = "new:" + group;
  }
  renderReview();
  $("dlg-mail").showModal();
}
function newGroups() {
  const g = new Map();
  for (const b of found) if (b.target.startsWith("new:")) {
    const cur = g.get(b.target) || { dest: "", start: b.date, end: b.end || b.date };
    cur.dest = cur.dest || (b.type !== "vuelo" && b.type !== "tren" ? b.dest : "") || b.dest;
    if (b.date < cur.start) cur.start = b.date;
    if ((b.end || b.date) > cur.end) cur.end = b.end || b.date;
    g.set(b.target, cur);
  }
  return g;
}
function renderReview() {
  const groups = newGroups();
  const trips = getTrips().filter((t) => (t.end || t.start) >= addDays(ymd(), -60)).sort((a, b) => a.start.localeCompare(b.start));
  $("ml-intro").textContent = `He encontrado ${found.length} ${found.length === 1 ? "reserva" : "reservas"} en ${mails.length} ${mails.length === 1 ? "correo" : "correos"}. Revisa y elige a qué viaje va cada una.`;
  $("ml-list").innerHTML = found.map((b, n) => `<li data-n="${n}" class="${b.on ? "" : "off"}">
    <input type="checkbox" id="ml-on-${n}" ${b.on ? "checked" : ""} aria-label="Añadir ${esc(b.name)}">
    <div class="ml-body">
      <span class="ml-title"><span class="bk-ico small">${TYPE_ICON(b.type)}</span>${esc(b.name)}</span>
      <span class="muted small-print">${esc(fmtDay(b.date))}${b.time ? " · " + esc(b.time) : ""}${b.end && b.end !== b.date ? " → " + esc(fmtDay(b.end)) : ""}${b.ref ? " · " + esc(b.ref) : ""}</span>
      ${b.dup ? `<span class="note small-print">Ya está en «${esc(b.dup.name)}»</span>` : ""}
      <label class="ml-target">Añadir a
        <select data-target="${n}">
          ${trips.map((t) => `<option value="${esc(t.id)}"${b.target === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}
          ${[...groups].map(([k, g]) => `<option value="${k}"${b.target === k ? " selected" : ""}>Viaje nuevo${g.dest ? " a " + esc(g.dest) : ""} (${esc(fmtDay(g.start))})</option>`).join("")}
          ${!b.target.startsWith("new:") ? `<option value="new:x${n}">Viaje nuevo${b.dest ? " a " + esc(b.dest) : ""}</option>` : ""}
        </select>
      </label>
    </div>
  </li>`).join("");
  const k = found.filter((b) => b.on).length;
  $("ml-add").disabled = !k;
  $("ml-add").textContent = k ? `Añadir ${k}` : "Añadir";
}
$("ml-list").addEventListener("change", (e) => {
  const li = e.target.closest("li[data-n]"); if (!li) return;
  const b = found[+li.dataset.n];
  if (e.target.type === "checkbox") b.on = e.target.checked;
  if (e.target.dataset.target != null) b.target = e.target.value;
  renderReview();
});
$("ml-close").addEventListener("click", () => $("dlg-mail").close());

async function markSeen(list, result) {
  const ids = [...new Set(list.map((b) => b.mailId))];
  if (!ids.length) return;
  const b = ctx.F.writeBatch(ctx.fs);
  ids.forEach((id) => b.set(subDoc("mailseen", safe(id)), { result, at: Date.now() }));
  await b.commit().catch(() => {});
}
$("ml-ignore").addEventListener("click", async () => {
  await markSeen(found, "ignored");
  $("dlg-mail").close();
  toast("No se volverán a proponer");
});
$("ml-add").addEventListener("click", async () => {
  const chosen = found.filter((b) => b.on);
  const groups = newGroups();
  const toBooking = (b) => ({ id: uidShort(), type: b.type, name: b.name, ref: b.ref, date: b.date, time: b.time, end: b.end, endTime: b.endTime, addr: b.addr, link: "", notes: b.notes, source: "correo" });
  let firstTrip = null, created = 0;
  try {
    const byTarget = new Map();
    for (const b of chosen) (byTarget.get(b.target) || byTarget.set(b.target, []).get(b.target)).push(b);
    for (const [target, list] of byTarget) {
      if (target.startsWith("new:")) {
        const g = groups.get(target) || { dest: list[0].dest, start: list[0].date, end: list[0].end || list[0].date };
        const start = list.reduce((m, b) => (b.date < m ? b.date : m), g.start);
        const end = list.reduce((m, b) => ((b.end || b.date) > m ? b.end || b.date : m), g.end);
        const r = await ctx.F.addDoc(sub("trips"), {
          name: g.dest ? `Viaje a ${g.dest}` : "Viaje", dest: g.dest || "", start, end: daysBetween(start, end) > 60 ? addDays(start, 60) : end,
          notes: "", bookings: list.map(toBooking), plans: [], createdAt: Date.now(), addedBy: ctx.uid,
        });
        firstTrip = firstTrip || r.id; created++;
      } else {
        const t = getTrips().find((x) => x.id === target);
        if (!t) continue;
        await ctx.F.updateDoc(subDoc("trips", t.id), { bookings: [...(t.bookings || []), ...list.map(toBooking)] });
        firstTrip = firstTrip || t.id;
      }
    }
    await markSeen(chosen, "added");
    await markSeen(found.filter((b) => !b.on), "ignored");
    $("dlg-mail").close();
    toast(`${chosen.length} ${chosen.length === 1 ? "reserva añadida" : "reservas añadidas"}${created ? ` · ${created} ${created === 1 ? "viaje nuevo" : "viajes nuevos"}` : ""}`);
    if (firstTrip && byTarget.size === 1) setTimeout(() => openTripById(firstTrip), 400);
  } catch (e) { failed(e); }
});

document.addEventListener("click", (e) => {
  if (e.target.closest("#v-mail")) scan();
});
