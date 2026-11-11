// Pestaña Calendario: eventos del calendario compartido de Google, como lista (con colores por persona) o con la vista de Google.
import { ctx, $, esc, cap, toast, failed, houseRef, ymd, addDays, fmtDayLong, relDay, calLink, mapsLink, LS, knownPeople, personColor, detectPerson } from "./core.js";
import { feedState, onFeed, refreshFeed, isMedical } from "./feed.js";

let mode = LS.get("bretona.calmode") || "AGENDA"; // AGENDA | WEEK | MONTH (vista de Google)
let view = LS.get("bretona.calview") || "lista";  // lista | google
let changing = false;
let days = 60;

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-event" class="sheet">
  <form method="dialog" id="ev-form">
    <h2>Nuevo evento</h2>
    <label class="field"><span>Qué</span><input id="ev-title" maxlength="100" placeholder="Cumpleaños de la abuela" required></label>
    <label class="check-row"><input type="checkbox" id="ev-allday"> Todo el día</label>
    <div class="row">
      <label class="field"><span>Día</span><input id="ev-date" type="date" required></label>
      <label class="field ev-time"><span>Empieza</span><input id="ev-start" type="time" value="10:00"></label>
      <label class="field ev-time"><span>Acaba</span><input id="ev-end" type="time" value="11:00"></label>
    </div>
    <label class="field"><span>Dónde</span><input id="ev-place" maxlength="120"></label>
    <label class="field"><span>Notas</span><textarea id="ev-notes" rows="2" maxlength="600"></textarea></label>
    <p class="muted small-print">Se abrirá Google Calendar con el evento relleno. Comprueba que esté elegido el calendario de la familia y pulsa <b>Guardar</b>. Si es para alguien en concreto, pon su nombre en el título para que salga con su color.</p>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <a class="btn" id="ev-go" href="#" target="_blank" rel="noopener">Abrir en Google Calendar</a>
    </div>
  </form>
</dialog>

<dialog id="dlg-feed" class="sheet">
  <form method="dialog" id="feed-form">
    <h2>Leer el calendario en BRETONA</h2>
    <p class="muted">Con esto, los eventos salen como lista dentro de la app (también en iPhone) y las citas médicas aparecen solas en Citas. Se hace una vez, desde el ordenador. Los pasos te los da Claude en el chat.</p>
    <label class="field"><span>Dirección de la aplicación web</span><input id="feed-url" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false" autocapitalize="off"></label>
    <p class="note" id="feed-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="feed-remove" hidden>Desconectar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function onShow() { refreshFeed(); render(true); }
export function onHouse() { refreshFeed(); if (!$("view-calendario").hidden) render(); }
export function stop() { changing = false; }
onFeed(() => { if (!$("view-calendario").hidden) render(true); });
ctx.onOverrides = () => { if (!$("view-calendario").hidden && view === "lista") render(true); };

function embedUrl(id) {
  const p = new URLSearchParams({ src: id, ctz: "Europe/Madrid", hl: "es", mode, wkst: "2", showTitle: "0", showPrint: "0", showCalendars: "0", showTz: "0", showNav: "1", showDate: "1", showTabs: "0" });
  return "https://calendar.google.com/calendar/embed?" + p.toString();
}
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "ahora mismo" : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };

function setupHtml(id) {
  return `
    <div class="view-head"><h1>Calendario</h1></div>
    <div class="card">
      <h2>Conecta vuestro calendario de Google</h2>
      <p class="muted">Se hace una vez y sirve para toda la familia. Desde el <b>ordenador</b>:</p>
      <ol class="steps">
        <li>Abre <b>calendar.google.com</b>.</li>
        <li>En la columna de la izquierda, pon el ratón sobre el calendario de la familia, pulsa los tres puntos <b>⋮</b> y luego <b>Configuración y uso compartido</b>.</li>
        <li>Baja hasta <b>Integrar el calendario</b> y copia el <b>ID de calendario</b>. Es algo como <code>abc123…@group.calendar.google.com</code>.</li>
      </ol>
      <form class="row" id="cal-form" autocomplete="off">
        <input id="cal-id" placeholder="ID del calendario" value="${esc(id || "")}" spellcheck="false" autocapitalize="off">
        <button class="btn" type="submit">Guardar</button>
      </form>
      ${changing ? `<button class="link" id="cal-cancel">Cancelar</button>` : ""}
      <p class="note" id="cal-msg"></p>
    </div>`;
}

function listHtml() {
  const st = feedState();
  const today = ymd(), until = addDays(today, days);
  const people = knownPeople();
  const evs = (st.events || []).filter((e) => (e.endDate || e.date) >= today && e.date <= until)
    .sort((a, b) => (a.date + (a.time || "00:00")).localeCompare(b.date + (b.time || "00:00")));
  const byDay = new Map();
  for (const e of evs) { const d = e.date < today ? today : e.date; (byDay.get(d) || byDay.set(d, []).get(d)).push(e); }
  const body = [...byDay.entries()].map(([d, list]) => `
    <section class="ev-day">
      <h3>${d === today ? "Hoy" : d === addDays(today, 1) ? "Mañana" : ""} <span>${esc(fmtDayLong(d))}</span></h3>
      <ul class="ev-list">${list.map((e) => {
        const who = ctx.calOverrides?.get(String(e.id).split("_")[0])?.who || detectPerson(e.title + " " + e.description, people);
        const c = who ? personColor(who, people) : -1;
        return `<li class="ev${c >= 0 ? " pc pc-" + c : ""}">
          <span class="ev-time">${e.allDay ? "Todo el día" : esc(e.time)}</span>
          <span class="ev-body"><span class="ev-title">${esc(e.title)}</span>
            <span class="ev-meta">${who ? `<span class="who-chip">${esc(who)}</span>` : ""}${isMedical(e) ? `<span class="med-tag">Cita médica</span>` : ""}${e.location ? `<a href="${esc(mapsLink(e.location))}" target="_blank" rel="noopener">${esc(e.location)}</a>` : ""}</span>
          </span></li>`;
      }).join("")}</ul>
    </section>`).join("");
  return `
    <div class="feed-status">
      <span class="muted">${st.status === "loading" ? '<span class="spinner"></span>Leyendo el calendario…' : st.fetchedAt ? `Actualizado ${ago(st.fetchedAt)}` : ""}</span>
      <button class="link small" id="feed-refresh">Actualizar</button>
    </div>
    ${st.status === "error" ? `<p class="note">${esc(st.errorMsg)}</p>` : ""}
    ${body || (st.events ? `<div class="empty"><strong>Nada en los próximos ${days} días</strong>Los eventos que añadáis al calendario de la familia aparecerán aquí.</div>` : "")}
    ${st.events && days < 365 ? `<button class="link" id="feed-more">Ver más adelante</button>` : ""}`;
}

function render(force = false) {
  const root = $("view-calendario");
  if (!root || !ctx.hid) return;
  const id = ctx.house?.calendarId;
  const feed = !!ctx.house?.calendarFeed;
  if (!id && !feed || changing) { root.innerHTML = setupHtml(id); return; }

  const v = feed ? view : "google";
  // No recargar el iframe si ya muestra lo mismo.
  const frame = root.querySelector("iframe");
  if (!force && v === "google" && id && frame && frame.dataset.src === embedUrl(id)) return;

  root.innerHTML = `
    <div class="view-head">
      <h1>Calendario</h1>
      <button class="btn" id="cal-new">Nuevo evento</button>
    </div>
    ${feed && id ? `<div class="seg wide" role="tablist">
      <button role="tab" data-view-cal="lista" aria-selected="${v === "lista"}">Lista</button>
      <button role="tab" data-view-cal="google" aria-selected="${v === "google"}">Vista de Google</button>
    </div>` : ""}
    ${v === "lista" ? listHtml() : `
      <div class="seg wide" role="tablist">
        ${[["AGENDA", "Agenda"], ["WEEK", "Semana"], ["MONTH", "Mes"]].map(([k, l]) => `<button role="tab" data-mode="${k}" aria-selected="${mode === k}">${l}</button>`).join("")}
      </div>
      <div class="cal-frame"><iframe title="Calendario de la familia" data-src="${esc(embedUrl(id))}" src="${esc(embedUrl(id))}" loading="lazy"></iframe></div>
      <p class="muted small-print">¿No ves los eventos? La vista de Google solo funciona si este móvil tiene abierta una cuenta de Google con acceso al calendario.</p>`}
    ${!feed ? `<div class="card feed-promo">
        <h3>Ver los eventos dentro de BRETONA</h3>
        <p class="muted">Como lista con los colores de cada persona, y con las citas médicas apareciendo solas en Citas.</p>
        <button class="btn ghost" id="feed-setup">Configurar</button>
      </div>` : ""}
    <div class="cal-foot">
      <a class="btn ghost" href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener">Abrir Google Calendar</a>
      <span>
        ${feed ? `<button class="link small" id="feed-setup">Lectura del calendario</button> · ` : ""}
        <button class="link small" id="cal-change">Cambiar de calendario</button>
      </span>
    </div>`;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-calendario")) return;
  const q = (s) => e.target.closest(s);
  if (q("[data-mode]")) { mode = q("[data-mode]").dataset.mode; LS.set("bretona.calmode", mode); render(true); return; }
  if (q("[data-view-cal]")) { view = q("[data-view-cal]").dataset.viewCal; LS.set("bretona.calview", view); render(true); return; }
  if (q("#cal-change")) { changing = true; render(true); return; }
  if (q("#cal-cancel")) { changing = false; render(true); return; }
  if (q("#cal-new")) return openEvent();
  if (q("#feed-refresh")) { refreshFeed(true); return; }
  if (q("#feed-more")) { days = days < 120 ? 120 : 365; render(true); return; }
  if (q("#feed-setup")) return openFeed();
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "cal-form") return;
  e.preventDefault();
  let v = $("cal-id").value.trim();
  // Acepta también el enlace de "insertar" o "dirección pública" y saca el ID.
  const m = v.match(/[?&]src=([^&]+)/) || v.match(/calendar\/ical\/([^/]+)\//);
  if (m) v = decodeURIComponent(m[1]);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { $("cal-msg").textContent = "Eso no parece un ID de calendario. Debe tener una @, por ejemplo abc123@group.calendar.google.com."; return; }
  changing = false;
  ctx.F.updateDoc(houseRef(), { calendarId: v }).then(() => toast("Calendario conectado")).catch(failed);
});

// Lectura del calendario (Apps Script)
function openFeed() {
  $("feed-url").value = ctx.house?.calendarFeed || "";
  $("feed-msg").textContent = "";
  $("feed-remove").hidden = !ctx.house?.calendarFeed;
  $("dlg-feed").showModal();
}
$("feed-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "save") return;
  e.preventDefault();
  const url = $("feed-url").value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)) { $("feed-msg").textContent = "Pega la dirección que te da Google al implementar: empieza por https://script.google.com/macros/s/ y acaba en /exec."; return; }
  $("feed-msg").innerHTML = '<span class="spinner"></span>Probando…';
  try {
    const r = await fetch(url, { redirect: "follow" });
    const data = await r.json();
    if (data.error) { $("feed-msg").textContent = "El programa responde, pero no encuentra el calendario. Revisa el ID que pegaste en él."; return; }
    await ctx.F.updateDoc(houseRef(), { calendarFeed: url });
    $("dlg-feed").close();
    view = "lista"; LS.set("bretona.calview", view);
    toast(`Leyendo «${data.calendario || "calendario"}»: ${data.eventos ?? (data.events || []).length} eventos`);
    refreshFeed(true);
  } catch (err) {
    console.error(err);
    $("feed-msg").textContent = "No se ha podido leer. Revisa que al implementar elegiste «Quién tiene acceso: Cualquier usuario» y que copiaste la dirección completa.";
  }
});
$("feed-remove").addEventListener("click", () => {
  ctx.F.updateDoc(houseRef(), { calendarFeed: ctx.F.deleteField() }).then(() => toast("Lectura del calendario desconectada")).catch(failed);
  $("dlg-feed").close();
});

// Nuevo evento (abre Google Calendar)
function openEvent() {
  $("ev-title").value = ""; $("ev-place").value = ""; $("ev-notes").value = "";
  $("ev-date").value = ymd(); $("ev-allday").checked = false;
  syncEvent();
  $("dlg-event").showModal();
}
function syncEvent() {
  const all = $("ev-allday").checked;
  document.querySelectorAll("#dlg-event .ev-time").forEach((el) => (el.hidden = all));
  const title = cap($("ev-title").value) || "Evento";
  $("ev-go").href = calLink({
    title, date: $("ev-date").value || ymd(), time: all ? "" : $("ev-start").value,
    endTime: all ? "" : $("ev-end").value, details: $("ev-notes").value, location: $("ev-place").value,
  });
}
$("ev-form").addEventListener("input", syncEvent);
$("ev-start").addEventListener("change", () => {
  const [h, m] = ($("ev-start").value || "10:00").split(":").map(Number);
  const end = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (!$("ev-end").value || $("ev-end").value <= $("ev-start").value) $("ev-end").value = end;
  syncEvent();
});
$("ev-go").addEventListener("click", (e) => {
  if (!$("ev-title").value.trim()) { e.preventDefault(); $("ev-title").focus(); return; }
  setTimeout(() => $("dlg-event").close(), 300);
  // Al volver a la app, releer el calendario para que salga el evento nuevo.
  setTimeout(() => refreshFeed(true), 20000);
});
