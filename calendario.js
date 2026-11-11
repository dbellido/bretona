// Pestaña Calendario: muestra el calendario compartido de Google y crea eventos en él.
import { ctx, $, esc, cap, toast, failed, houseRef, ymd, calLink, LS } from "./core.js";

let mode = LS.get("bretona.calmode") || "AGENDA"; // AGENDA | WEEK | MONTH
let changing = false;

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
    <p class="muted small-print">Se abrirá Google Calendar con el evento relleno. Comprueba que esté elegido el calendario de la familia y pulsa <b>Guardar</b>.</p>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <a class="btn" id="ev-go" href="#" target="_blank" rel="noopener">Abrir en Google Calendar</a>
    </div>
  </form>
</dialog>`);

export function onShow() { render(); }
export function onHouse() { if (!$("view-calendario").hidden) render(); }
export function stop() { changing = false; }

function embedUrl(id) {
  const p = new URLSearchParams({ src: id, ctz: "Europe/Madrid", hl: "es", mode, wkst: "2", showTitle: "0", showPrint: "0", showCalendars: "0", showTz: "0", showNav: "1", showDate: "1", showTabs: "0" });
  return "https://calendar.google.com/calendar/embed?" + p.toString();
}

function render() {
  const root = $("view-calendario");
  if (!root || !ctx.hid) return;
  const id = ctx.house?.calendarId;
  // Si el iframe ya muestra este calendario y modo, no lo recargamos.
  const frame = root.querySelector("iframe");
  if (id && !changing && frame && frame.dataset.src === embedUrl(id)) return;

  if (!id || changing) {
    root.innerHTML = `
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
    return;
  }

  root.innerHTML = `
    <div class="view-head">
      <h1>Calendario</h1>
      <button class="btn" id="cal-new">Nuevo evento</button>
    </div>
    <div class="seg wide" role="tablist">
      ${[["AGENDA", "Agenda"], ["WEEK", "Semana"], ["MONTH", "Mes"]].map(([k, l]) => `<button role="tab" data-mode="${k}" aria-selected="${mode === k}">${l}</button>`).join("")}
    </div>
    <div class="cal-frame"><iframe title="Calendario de la familia" data-src="${esc(embedUrl(id))}" src="${esc(embedUrl(id))}" loading="lazy"></iframe></div>
    <div class="cal-foot">
      <a class="btn ghost" href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener">Abrir Google Calendar</a>
      <button class="link small" id="cal-change">Cambiar de calendario</button>
    </div>
    <p class="muted small-print">¿No ves los eventos? El calendario solo se muestra si este móvil tiene abierta una cuenta de Google con acceso a él. Si no aparece, usa “Abrir Google Calendar”.</p>`;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-calendario")) return;
  const q = (s) => e.target.closest(s);
  if (q("[data-mode]")) { mode = q("[data-mode]").dataset.mode; LS.set("bretona.calmode", mode); render(); return; }
  if (q("#cal-change")) { changing = true; render(); return; }
  if (q("#cal-cancel")) { changing = false; render(); return; }
  if (q("#cal-new")) openEvent();
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
});
