// Pestaña Citas médicas: las de toda la familia, metidas a mano o leídas del calendario de Google.
import {
  ctx, $, esc, cap, norm, failed, sub, subDoc, houseRef,
  ymd, parseYmd, fmtDayLong, relDay, daysBetween, calLink, mapsLink,
  knownPeople, personColor, personKey, detectPerson,
} from "./core.js";
import { feedState, onFeed, refreshFeed, isMedical } from "./feed.js";

let appts = [], unsub = null;
let who = "";            // filtro por persona ("" = todos)
let showPast = false;
let editingId = null;

const SPECIALTIES = ["Médico de cabecera", "Pediatra", "Enfermería", "Dentista", "Oftalmólogo", "Dermatólogo", "Ginecólogo", "Traumatólogo", "Cardiólogo", "Otorrino", "Fisioterapia", "Análisis de sangre", "Vacuna", "Revisión", "Urgencias", "Psicólogo"];

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-cita" class="sheet">
  <form method="dialog" id="ci-form">
    <h2 id="ci-title">Nueva cita</h2>
    <div class="row">
      <label class="field"><span>Para quién</span><input id="ci-who" list="ci-who-list" maxlength="30" required placeholder="Nombre"></label>
      <label class="field"><span>Especialidad</span><input id="ci-spec" list="ci-spec-list" maxlength="40" required placeholder="Pediatra"></label>
    </div>
    <div class="row">
      <label class="field"><span>Día</span><input id="ci-date" type="date" required></label>
      <label class="field"><span>Hora</span><input id="ci-time" type="time"></label>
    </div>
    <label class="field"><span>Médico/a</span><input id="ci-doc" maxlength="60" placeholder="Dra. López"></label>
    <label class="field"><span>Centro o dirección</span><input id="ci-place" maxlength="120" placeholder="Centro de salud, consulta 12"></label>
    <label class="field"><span>Motivo</span><input id="ci-reason" maxlength="120" placeholder="Revisión anual"></label>
    <label class="field"><span>A tener en cuenta</span><textarea id="ci-notes" rows="2" maxlength="600" placeholder="Ir en ayunas, llevar la tarjeta sanitaria, informes…"></textarea></label>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="ci-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
  <datalist id="ci-who-list"></datalist>
  <datalist id="ci-spec-list">${SPECIALTIES.map((s) => `<option value="${s}">`).join("")}</datalist>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("appointments"), (s) => {
    appts = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; appts = []; }
export function onShow() { refreshFeed(); render(); }
export function onHouse() { refreshFeed(); render(); }
onFeed(() => render());

const people = () => knownPeople(appts.map((a) => a.who));
const eventTitle = (a) => `${a.spec}${a.who ? " · " + a.who : ""}`;
const details = (a) => [a.doc && "Médico/a: " + a.doc, a.reason && "Motivo: " + a.reason, a.notes].filter(Boolean).join("\n");

// Citas leídas del calendario, sin repetir las que ya están metidas a mano
// (por ejemplo, las que se pasaron al calendario con el botón "Al calendario").
function calendarAppts(ppl) {
  const evs = feedState().events || [];
  return evs.filter(isMedical).filter((e) => !appts.some((a) =>
    a.date === e.date && ((a.time && a.time === e.time) || norm(e.title).includes(norm(a.spec)))))
    .map((e) => ({
      id: "cal:" + e.id, fromCal: true, date: e.date, time: e.time, spec: e.title,
      who: detectPerson(e.title + " " + e.description, ppl), place: e.location, notes: e.description,
    }));
}

function card(a, past, ppl) {
  const d = parseYmd(a.date);
  const soon = !past && daysBetween(ymd(), a.date) <= 2;
  const c = a.who ? personColor(a.who, ppl) : -1;
  return `<li class="appt${past ? " past" : ""}${soon ? " soon" : ""}${c >= 0 ? " pc pc-" + c : ""}">
    <div class="appt-date" aria-hidden="true"><span class="ad-day">${d.getDate()}</span><span class="ad-mon">${new Intl.DateTimeFormat("es-ES", { month: "short" }).format(d).replace(".", "")}</span></div>
    <div class="appt-body">
      <span class="appt-when">${esc(past ? fmtDayLong(a.date) : relDay(a.date) + " · " + fmtDayLong(a.date))}${a.time ? " · " + esc(a.time) : ""}</span>
      <span class="appt-title">${esc(a.spec)} ${a.who ? `<span class="who-chip">${esc(a.who)}</span>` : ""}</span>
      ${a.doc || a.reason ? `<span class="muted">${esc([a.doc, a.reason].filter(Boolean).join(" · "))}</span>` : ""}
      ${a.notes && !past ? `<span class="appt-notes">${esc(a.notes)}</span>` : ""}
      <span class="bk-links">
        ${a.place && !past ? `<a href="${esc(mapsLink(a.place))}" target="_blank" rel="noopener">${esc(a.place)}</a>` : ""}
        ${!past && !a.fromCal ? `<a href="${esc(calLink({ title: eventTitle(a), date: a.date, time: a.time, minutes: 45, details: details(a), location: a.place || "" }))}" target="_blank" rel="noopener">Al calendario</a>` : ""}
        ${a.fromCal ? `<span class="from-cal">Del calendario de Google</span>` : ""}
      </span>
    </div>
    ${a.fromCal ? "" : `<button class="more" data-cita="${esc(a.id)}" aria-label="Editar cita de ${esc(a.who)}">•••</button>`}
  </li>`;
}

function render() {
  const root = $("view-citas");
  if (!root || !ctx.hid) return;
  const today = ymd();
  const ppl = people();
  const all = [...appts, ...calendarAppts(ppl)];
  const list = all.filter((a) => !who || personKey(a.who) === personKey(who));
  const upcoming = list.filter((a) => a.date >= today).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const past = list.filter((a) => a.date < today).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
  const withAppts = ppl.filter((p) => all.some((a) => personKey(a.who) === personKey(p)));
  const st = feedState();
  root.innerHTML = `
    <div class="view-head"><h1>Citas médicas</h1><button class="btn" id="ci-new">Nueva cita</button></div>
    ${withAppts.length > 1 ? `<div class="filters">${[["", "Todos", -1], ...withAppts.map((p) => [p, p, personColor(p, ppl)])].map(([v, l, c]) =>
      `<button class="filter${c >= 0 ? " pc pc-" + c : ""}" data-who="${esc(v)}" aria-selected="${personKey(who) === personKey(v)}">${esc(l)}</button>`).join("")}</div>` : ""}
    ${upcoming.length ? `<ul class="appts">${upcoming.map((a) => card(a, false, ppl)).join("")}</ul>`
      : `<div class="empty"><strong>No hay citas pendientes</strong>Apunta aquí las citas de cualquiera de la familia. Todos las veréis, y con un toque se pasan al calendario de Google para que os avise.</div>`}
    ${st.configured ? `<p class="muted small-print">Las citas con palabras como médico, pediatra, dentista o análisis en vuestro calendario de Google salen aquí solas.${st.status === "error" ? ` <span class="note">${esc(st.errorMsg)}</span>` : ""}</p>` : ""}
    ${past.length ? `<section class="panel plain">
      <button class="link" id="ci-past">${showPast ? "Ocultar" : "Ver"} citas anteriores (${past.length})</button>
      ${showPast ? `<ul class="appts">${past.slice(0, 50).map((a) => card(a, true, ppl)).join("")}</ul>` : ""}
    </section>` : ""}`;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-citas")) return;
  const q = (s) => e.target.closest(s);
  if (q("#ci-new")) return openCita(null);
  if (q("#ci-past")) { showPast = !showPast; render(); return; }
  if (q("[data-who]")) { who = q("[data-who]").dataset.who; render(); return; }
  if (q("[data-cita]")) openCita(appts.find((a) => a.id === q("[data-cita]").dataset.cita));
});

function openCita(a) {
  editingId = a?.id || null;
  $("ci-title").textContent = a ? "Editar cita" : "Nueva cita";
  $("ci-who-list").innerHTML = people().map((p) => `<option value="${esc(p)}">`).join("");
  $("ci-who").value = a?.who || who || "";
  $("ci-spec").value = a?.spec || ""; $("ci-date").value = a?.date || ""; $("ci-time").value = a?.time || "";
  $("ci-doc").value = a?.doc || ""; $("ci-place").value = a?.place || ""; $("ci-reason").value = a?.reason || ""; $("ci-notes").value = a?.notes || "";
  $("ci-delete").hidden = !a;
  $("dlg-cita").showModal();
}
$("ci-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const data = {
    who: cap($("ci-who").value).slice(0, 30), spec: cap($("ci-spec").value).slice(0, 40),
    date: $("ci-date").value, time: $("ci-time").value, doc: cap($("ci-doc").value).slice(0, 60),
    place: $("ci-place").value.trim().slice(0, 120), reason: cap($("ci-reason").value).slice(0, 120), notes: $("ci-notes").value.trim().slice(0, 600),
  };
  // Si es alguien nuevo (un niño, un abuelo…), se guarda en la lista de personas de la familia.
  if (data.who && !knownPeople().some((p) => personKey(p) === personKey(data.who)))
    ctx.F.updateDoc(houseRef(), { people: ctx.F.arrayUnion(data.who) }).catch(() => {});
  if (editingId) ctx.F.updateDoc(subDoc("appointments", editingId), data).catch(failed);
  else ctx.F.addDoc(sub("appointments"), { ...data, addedBy: ctx.uid, createdAt: Date.now() }).catch(failed);
  editingId = null;
});
$("ci-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("appointments", editingId)).catch(failed);
  editingId = null;
  $("dlg-cita").close();
});
