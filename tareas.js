// Pestaña Tareas: tareas de casa con persona, fecha y repetición.
import {
  ctx, $, esc, cap, toast, failed, sub, subDoc, houseRef, memberName,
  ymd, addDays, parseYmd, fmtDay, relDay, daysBetween, knownPeople, personColor, personKey, LS,
} from "./core.js";

let tasks = [], unsub = null;
let who = LS.get("bretona.taskwho") || "";   // "" todos, "__me" mías, o nombre
let showDone = false, editingId = null;

const REPEAT = { "": "No se repite", daily: "Cada día", weekly: "Cada semana", biweekly: "Cada 2 semanas", monthly: "Cada mes" };

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-task" class="sheet">
  <form method="dialog" id="tk-form">
    <h2 id="tk-title">Nueva tarea</h2>
    <label class="field"><span>Tarea</span><input id="tk-name" maxlength="100" required placeholder="Sacar la basura"></label>
    <div class="row">
      <label class="field"><span>Para quién</span><input id="tk-who" list="tk-who-list" maxlength="30" placeholder="Cualquiera"></label>
      <label class="field"><span>Para cuándo</span><input id="tk-due" type="date"></label>
    </div>
    <label class="field"><span>Repetir</span><select id="tk-repeat">${Object.entries(REPEAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <label class="field"><span>Notas</span><textarea id="tk-notes" rows="2" maxlength="600"></textarea></label>
    <p class="note" id="tk-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="tk-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
  <datalist id="tk-who-list"></datalist>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("tasks"), (s) => {
    tasks = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render(); ctx.onTasks?.();
  }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; tasks = []; }
export function onShow() { render(); }
export function onHouse() { render(); }
// Tareas pendientes para hoy o atrasadas de esta persona (para el aviso en la barra).
export const myDueCount = () => tasks.filter((t) => !t.done && t.due && t.due <= ymd() && (!t.who || personKey(t.who) === personKey(memberName(ctx.uid)))).length;

function nextDate(due, repeat) {
  const step = (d) => repeat === "daily" ? addDays(d, 1) : repeat === "weekly" ? addDays(d, 7) : repeat === "biweekly" ? addDays(d, 14)
    : (() => { const x = parseYmd(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + 1); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return ymd(x); })();
  let n = step(due || ymd());
  for (let i = 0; i < 400 && n <= ymd(); i++) n = step(n);
  return n;
}

function itemHtml(t, ppl) {
  const c = t.who ? personColor(t.who, ppl) : -1;
  const late = !t.done && t.due && t.due < ymd();
  const when = t.done ? `Hecha ${relDay(ymd(new Date(t.doneAt || Date.now()))).toLowerCase()}${t.doneBy ? " por " + (memberName(t.doneBy) || "alguien") : ""}`
    : t.due ? relDay(t.due) + (Math.abs(daysBetween(ymd(), t.due)) > 1 ? " · " + fmtDay(t.due) : "") : "";
  return `<li class="item task${t.done ? " done" : ""}${late ? " late" : ""}" data-id="${esc(t.id)}">
    <button class="check" data-act="toggle" aria-label="${t.done ? "Desmarcar" : "Hecha"}: ${esc(t.title)}">${t.done ? '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}</button>
    <div class="label" data-act="edit"><span class="name">${esc(t.title)}</span>
      <span class="meta">${t.who ? `<span class="who-chip pc pc-${c}">${esc(t.who)}</span>` : ""}${when ? `<span class="${late ? "late-text" : ""}">${esc(when)}</span>` : ""}${t.repeat && !t.done ? `<span>↻ ${esc(REPEAT[t.repeat].toLowerCase())}</span>` : ""}</span>
    </div>
  </li>`;
}

function render() {
  const root = $("view-tareas");
  if (!root || !ctx.hid) return;
  const today = ymd(), week = addDays(today, 7);
  const ppl = knownPeople(tasks.map((t) => t.who));
  const me = memberName(ctx.uid);
  const mine = (t) => !t.who || personKey(t.who) === personKey(me);
  const match = (t) => !who ? true : who === "__me" ? mine(t) : personKey(t.who) === personKey(who);
  const open = tasks.filter((t) => !t.done && match(t)).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (a.createdAt || 0) - (b.createdAt || 0));
  const groups = [
    ["Atrasadas", open.filter((t) => t.due && t.due < today)],
    ["Hoy", open.filter((t) => t.due === today)],
    ["Próximos 7 días", open.filter((t) => t.due > today && t.due <= week)],
    ["Más adelante", open.filter((t) => t.due > week)],
    ["Sin fecha", open.filter((t) => !t.due)],
  ].filter(([, l]) => l.length);
  const done = tasks.filter((t) => t.done && match(t) && Date.now() - (t.doneAt || 0) < 14 * 86400000).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const chips = [["", "Todos", -1], ["__me", "Mías", -1], ...ppl.filter((p) => tasks.some((t) => personKey(t.who) === personKey(p))).map((p) => [p, p, personColor(p, ppl)])];

  root.innerHTML = `
    <div class="view-head"><h1>Tareas</h1></div>
    <form class="add" id="tk-quick" autocomplete="off">
      <input id="tk-quick-name" placeholder="Nueva tarea…" maxlength="100" aria-label="Nueva tarea" enterkeyhint="done">
      <select id="tk-quick-who" aria-label="Para quién" class="who-select">
        <option value="">Cualquiera</option>${ppl.map((p) => `<option value="${esc(p)}"${who && who !== "__me" && personKey(who) === personKey(p) ? " selected" : ""}>${esc(p)}</option>`).join("")}
      </select>
      <button class="btn" type="submit">Añadir</button>
    </form>
    <div class="filters" style="margin-top:10px">${chips.map(([v, l, c]) => `<button class="filter${c >= 0 ? " pc pc-" + c : ""}" data-twho="${esc(v)}" aria-selected="${who === v}">${esc(l)}</button>`).join("")}</div>
    ${groups.map(([title, list]) => `<section class="aisle${title === "Atrasadas" ? " late-group" : ""}"><h2>${title} <span class="n">${list.length}</span></h2><ul class="items">${list.map((t) => itemHtml(t, ppl)).join("")}</ul></section>`).join("")}
    ${!open.length ? `<div class="empty"><strong>${tasks.some((t) => !t.done) ? "Nada pendiente aquí" : "Sin tareas"}</strong>Apunta lo que hay que hacer en casa y para quién. Las que se repiten (sacar la basura, regar las plantas) vuelven a aparecer solas.</div>` : ""}
    ${done.length ? `<section class="cart"><button class="link" id="tk-show-done">${showDone ? "Ocultar" : "Ver"} hechas (${done.length})</button>
      ${showDone ? `<ul class="items" style="margin-top:6px">${done.map((t) => itemHtml(t, ppl)).join("")}</ul>` : ""}</section>` : ""}`;
}

/* ---------- Eventos ---------- */
document.addEventListener("submit", (e) => {
  if (e.target.id !== "tk-quick") return;
  e.preventDefault();
  const title = cap($("tk-quick-name").value).slice(0, 100);
  if (!title) return;
  const w = $("tk-quick-who").value;
  ctx.F.addDoc(sub("tasks"), { title, who: w, due: "", repeat: "", notes: "", done: false, addedBy: ctx.uid, createdAt: Date.now() }).catch(failed);
  $("tk-quick-name").value = "";
  $("tk-quick-name").focus();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-tareas")) return;
  const q = (s) => e.target.closest(s);
  if (q("[data-twho]")) { who = q("[data-twho]").dataset.twho; LS.set("bretona.taskwho", who); render(); return; }
  if (q("#tk-show-done")) { showDone = !showDone; render(); return; }
  const li = q(".task"); if (!li) return;
  const t = tasks.find((x) => x.id === li.dataset.id); if (!t) return;
  const act = q("[data-act]")?.dataset.act;
  if (act === "edit") return openTask(t);
  if (act === "toggle") {
    if (!t.done && t.repeat) {
      const next = nextDate(t.due, t.repeat);
      ctx.F.updateDoc(subDoc("tasks", t.id), { due: next, lastDoneAt: Date.now(), lastDoneBy: ctx.uid })
        .then(() => toast(`Hecha. La próxima: ${fmtDay(next)}`)).catch(failed);
    } else {
      ctx.F.updateDoc(subDoc("tasks", t.id), { done: !t.done, doneAt: !t.done ? Date.now() : null, doneBy: !t.done ? ctx.uid : null }).catch(failed);
    }
  }
});

function openTask(t) {
  editingId = t?.id || null;
  $("tk-title").textContent = t ? "Editar tarea" : "Nueva tarea";
  $("tk-who-list").innerHTML = knownPeople().map((p) => `<option value="${esc(p)}">`).join("");
  $("tk-name").value = t?.title || ""; $("tk-who").value = t?.who || "";
  $("tk-due").value = t?.due || ""; $("tk-repeat").value = t?.repeat || ""; $("tk-notes").value = t?.notes || "";
  $("tk-msg").textContent = "";
  $("tk-delete").hidden = !t;
  $("dlg-task").showModal();
}
$("tk-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const repeat = $("tk-repeat").value;
  let due = $("tk-due").value;
  if (repeat && !due) due = ymd();
  const w = cap($("tk-who").value).slice(0, 30);
  if (w && !knownPeople().some((p) => personKey(p) === personKey(w)))
    ctx.F.updateDoc(houseRef(), { people: ctx.F.arrayUnion(w) }).catch(() => {});
  const data = { title: cap($("tk-name").value).slice(0, 100), who: w, due, repeat, notes: $("tk-notes").value.trim().slice(0, 600) };
  if (editingId) ctx.F.updateDoc(subDoc("tasks", editingId), data).catch(failed);
  else ctx.F.addDoc(sub("tasks"), { ...data, done: false, addedBy: ctx.uid, createdAt: Date.now() }).catch(failed);
  editingId = null;
});
$("tk-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("tasks", editingId)).catch(failed);
  editingId = null;
  $("dlg-task").close();
});
