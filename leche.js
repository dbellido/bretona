// Pestaña Banco de leche: plan de extracción, almacén (nevera y congelador) y cuántas semanas cubre la reserva.
import { ctx, $, esc, toast, failed, sub, subDoc, houseRef, ymd, addDays, parseYmd, daysBetween, fmtDay, fmtDayLong, fmtDate, relDay, calLink } from "./core.js";

let bags = [], unsub = null;
let editingId = null, showUsed = false;

// Pautas habituales de conservación de leche materna.
const LIFE = { nevera: 4, congelador: 182 }; // días (congelador: 6 meses)
const WD = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
// Plan: desde esta semana hasta la vuelta al trabajo (4 de enero), para llegar con reserva para 15 jornadas.
const DEFAULT_PLAN = { start: "2026-11-09", workStart: "2027-01-04", weekdays: [1, 3, 5], reserveDays: [5], time: "10:00", mlPerSession: 150, bottles: 3, mlBottle: 150, goalDays: 15 };
const plan = () => {
  const p = { ...DEFAULT_PLAN, ...(ctx.house?.milkPlan2 || {}) };
  p.dailyNeed = p.bottles * p.mlBottle; // ml en una jornada laborable
  return p;
};
const dec = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");
const ml = (n) => { const v = Math.round(n); try { return v.toLocaleString("es-ES", { useGrouping: "always" }) + " ml"; } catch { return v.toLocaleString("es-ES") + " ml"; } };
const expiry = (b) => addDays(b.date, b.place === "congelador" ? LIFE.congelador : LIFE.nevera);
const expired = (b) => expiry(b) < ymd();

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-milk" class="sheet">
  <form method="dialog" id="mk-form">
    <h2 id="mk-title">Registrar extracción</h2>
    <div class="row">
      <label class="field"><span>Cantidad (ml)</span><input id="mk-ml" type="number" inputmode="numeric" min="5" max="1000" step="5" required></label>
      <label class="field"><span>Día</span><input id="mk-date" type="date" required></label>
      <label class="field" style="flex:0 0 110px"><span>Hora</span><input id="mk-time" type="time"></label>
    </div>
    <label class="field"><span>Para</span><select id="mk-place">
      <option value="nevera">Consumir (nevera, dura ${LIFE.nevera} días)</option>
      <option value="congelador">Reserva (congelador, dura 6 meses)</option>
    </select></label>
    <label class="field"><span>Notas</span><input id="mk-notes" maxlength="120" placeholder="Bolsa 1, extractor…"></label>
    <p class="muted small-print">Si sacas leche en varias bolsas, registra cada una por separado: así se puede usar de una en una.</p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="mk-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-milkplan" class="sheet">
  <form method="dialog" id="mp2-form">
    <h2>Plan y objetivo</h2>
    <div class="row">
      <label class="field"><span>Empezar a extraer</span><input id="mp2-start" type="date" required></label>
      <label class="field"><span>Vuelta al trabajo</span><input id="mp2-work" type="date" required></label>
    </div>
    <fieldset class="days-pick"><legend>Días de extracción</legend>
      ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" value="${d}" name="mp2-wd"> ${WD[d].slice(0, 3)}</label>`).join("")}
    </fieldset>
    <fieldset class="days-pick"><legend>De esos, para la reserva (congelador)</legend>
      ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" value="${d}" name="mp2-rd"> ${WD[d].slice(0, 3)}</label>`).join("")}
    </fieldset>
    <div class="row">
      <label class="field"><span>ml por extracción (aprox.)</span><input id="mp2-ml" type="number" min="10" max="1000" step="10"></label>
      <label class="field" style="flex:0 0 110px"><span>Hora</span><input id="mp2-time" type="time"></label>
    </div>
    <p class="muted small-print">Lo que tiene que cubrir la reserva desde la vuelta al trabajo:</p>
    <div class="row">
      <label class="field"><span>Biberones por jornada</span><input id="mp2-bottles" type="number" min="1" max="8"></label>
      <label class="field"><span>ml por biberón</span><input id="mp2-mlb" type="number" min="30" max="300" step="10"></label>
      <label class="field"><span>Jornadas</span><input id="mp2-goal" type="number" min="1" max="120"></label>
    </div>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("milk"), (s) => { bags = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; bags = []; }
export function onShow() { render(); }
export function onHouse() { render(); }

/* ---------- Plan ---------- */
function sessions() {
  const p = plan(), out = [];
  const n = Math.min(Math.max(daysBetween(p.start, p.workStart), 0), 200);
  for (let i = 0; i < n; i++) {
    const date = addDays(p.start, i), wd = parseYmd(date).getDay();
    if (!p.weekdays.includes(wd)) continue;
    out.push({ date, purpose: p.reserveDays.includes(wd) ? "congelador" : "nevera" });
  }
  return out;
}

function render() {
  const root = $("view-leche");
  if (!root || !ctx.hid) return;
  const p = plan(), today = ymd();
  const live = bags.filter((b) => !b.used);
  const frozen = live.filter((b) => b.place === "congelador" && !expired(b)).sort((a, b) => a.date.localeCompare(b.date));
  const fridge = live.filter((b) => b.place === "nevera" && !expired(b)).sort((a, b) => a.date.localeCompare(b.date));
  const gone = live.filter(expired);
  const reserve = frozen.reduce((s, b) => s + (b.ml || 0), 0);
  const fridgeMl = fridge.reduce((s, b) => s + (b.ml || 0), 0);
  const daysCovered = p.dailyNeed ? reserve / p.dailyNeed : 0;   // jornadas laborables
  const weeksCovered = daysCovered / 5;
  const goalMl = p.goalDays * p.dailyNeed;
  const pct = goalMl ? Math.min(100, (reserve / goalMl) * 100) : 0;

  const ss = sessions();
  const doneOn = (s) => bags.some((b) => b.date === s.date);
  const future = ss.filter((s) => s.date >= today && !doneOn(s));
  const projected = reserve + future.filter((s) => s.purpose === "congelador").length * p.mlPerSession;
  const daysLeft = Math.max(0, daysBetween(today, p.workStart));
  const weeksLeft = daysLeft / 7;
  const missing = Math.max(0, goalMl - projected);
  // Cuántas extracciones de reserva por semana harían falta desde hoy para llegar al objetivo.
  const needPerWeek = weeksLeft > 0 ? Math.ceil((goalMl - reserve) / p.mlPerSession / weeksLeft) : 0;
  const reservePerWeek = p.reserveDays.filter((d) => p.weekdays.includes(d)).length;
  const next = future[0];

  const bagHtml = (b, first) => {
    const left = daysBetween(today, expiry(b));
    return `<li class="bag${first ? " first" : ""}${expired(b) ? " expired" : ""}${b.used ? " used" : ""}">
      <span class="bag-ml">${b.ml}<small> ml</small></span>
      <span class="bag-body">
        <span>${esc(fmtDay(b.date))}${b.time ? " · " + esc(b.time) : ""}${b.notes ? " · " + esc(b.notes) : ""}</span>
        <span class="muted small-print">${b.used ? "Usada " + esc(fmtDate(ymd(new Date(b.usedAt || Date.now())))) : expired(b) ? "Caducada el " + esc(fmtDate(expiry(b))) : `Caduca ${left <= 7 ? relDay(expiry(b)).toLowerCase() : "el " + fmtDate(expiry(b))}`}${first && !b.used ? ' · <b class="first-tag">usar primero</b>' : ""}</span>
      </span>
      <span class="bag-actions">
        ${!b.used && !expired(b) ? `<button class="btn ghost small" data-use="${esc(b.id)}">Usar</button>` : ""}
        ${!b.used && b.place === "nevera" && !expired(b) ? `<button class="link small" data-freeze="${esc(b.id)}">Congelar</button>` : ""}
        <button class="more" data-bag="${esc(b.id)}" aria-label="Editar">•••</button>
      </span>
    </li>`;
  };

  const used = bags.filter((b) => b.used).sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
  root.innerHTML = `
    <div class="view-head"><h1>Banco de leche</h1><button class="btn" id="mk-new">Registrar extracción</button></div>

    <section class="milk-hero">
      <div class="mh-main">
        <span class="kpi-label">Reserva en el congelador</span>
        <span class="mh-big">${ml(reserve)}</span>
        <span class="mh-sub">Cubre <b>${dec(daysCovered)} jornadas</b> de ${p.bottles} biberones · <b>${dec(weeksCovered)} semanas</b> de trabajo</span>
      </div>
      <div class="mh-goal">
        <div class="goal-bar" role="img" aria-label="${Math.round(pct)}% del objetivo"><span style="width:${pct}%"></span></div>
        <span class="muted small-print">Objetivo: ${p.goalDays} jornadas × ${p.bottles} biberones de ${p.mlBottle} ml = <b>${ml(goalMl)}</b> · ${Math.round(pct)}%${p.bottles > 2 ? ` (con ${p.bottles - 1} biberones: ${ml(p.goalDays * (p.bottles - 1) * p.mlBottle)})` : ""}</span>
      </div>
      ${daysLeft > 0 ? `<div class="mh-forecast ${missing ? "short" : "ok"}">
        <b>${daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`} para el ${esc(fmtDayLong(p.workStart))}.</b>
        ${missing
          ? `Con el plan actual llegaríais con unos <b>${ml(projected)}</b> (${dec(p.dailyNeed ? projected / p.dailyNeed : 0)} jornadas): <b>faltarían ${ml(missing)}</b>.
             Para llegar hacen falta unas <b>${needPerWeek} extracciones de reserva por semana</b> de ~${p.mlPerSession} ml${reservePerWeek ? ` (ahora hay ${reservePerWeek})` : ""}. <button class="link small" id="mk-plan2">Ajustar el plan</button>`
          : `Con el plan actual llegaríais con unos <b>${ml(projected)}</b>: <b>vais bien</b> para ${dec(p.dailyNeed ? projected / p.dailyNeed : 0)} jornadas.`}
      </div>` : ""}
      <div class="mh-row"><span><b>${ml(fridgeMl)}</b> en la nevera para consumir</span></div>
    </section>

    ${next ? `<div class="next-session${next.date === today ? " today" : ""}">
      <span><b>${next.date === today ? "Hoy toca extracción" : "Próxima extracción: " + esc(relDay(next.date).toLowerCase())}</b> · ${esc(fmtDayLong(next.date))} · ${next.purpose === "congelador" ? "para la <b>reserva</b>" : "para consumir"}</span>
      <button class="btn small" data-reg="${next.date}" data-purpose="${next.purpose}">Registrar</button>
    </div>` : ""}

    <section class="panel">
      <h2>Congelador · reserva <span class="n">${frozen.length} ${frozen.length === 1 ? "bolsa" : "bolsas"}</span></h2>
      ${frozen.length ? `<ul class="bags">${frozen.map((b, i) => bagHtml(b, i === 0)).join("")}</ul>` : `<p class="muted">Aún no hay leche congelada. Las extracciones de reserva aparecerán aquí.</p>`}
    </section>
    <section class="panel">
      <h2>Nevera · para consumir <span class="n">${fridge.length}</span></h2>
      ${fridge.length ? `<ul class="bags">${fridge.map((b, i) => bagHtml(b, i === 0)).join("")}</ul>` : `<p class="muted">Nada en la nevera.</p>`}
    </section>
    ${gone.length ? `<section class="panel"><h2>Caducadas <span class="n">${gone.length}</span></h2><ul class="bags">${gone.map((b) => bagHtml(b, false)).join("")}</ul>
      <p class="muted small-print">No cuentan en la reserva. Bórralas desde ••• cuando las tiréis.</p></section>` : ""}

    <section class="panel">
      <div class="panel-head"><h2>Plan de extracción</h2><button class="link small" id="mk-plan">Cambiar plan</button></div>
      <p class="muted small-print">${esc(fmtDate(p.start))} – ${esc(fmtDate(addDays(p.workStart, -1)))} · ${p.weekdays.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d].toLowerCase() + (p.reserveDays.includes(d) ? " (reserva)" : "")).join(", ")} · ${ss.filter((s) => s.purpose === "nevera").length} para consumir y ${ss.filter((s) => s.purpose === "congelador").length} para la reserva</p>
      <ul class="sessions">${ss.filter((s) => s.date >= addDays(today, -7)).map((s) => {
        const done = doneOn(s), past = s.date < today;
        return `<li class="session ${done ? "done" : past ? "missed" : s.date === today ? "today" : ""}">
          <span class="ss-date">${esc(fmtDay(s.date))}</span>
          <span class="ss-type ${s.purpose}">${s.purpose === "congelador" ? "Reserva" : "Consumo"}</span>
          <span class="ss-state">${done ? "✓ Hecha" : past ? "Sin registrar" : s.date === today ? "Hoy" : `<a href="${esc(calLink({ title: "Extracción de leche · " + (s.purpose === "congelador" ? "reserva" : "consumo"), date: s.date, time: p.time, minutes: 30 }))}" target="_blank" rel="noopener">Al calendario</a>`}</span>
          ${done ? "" : `<button class="link small" data-reg="${s.date}" data-purpose="${s.purpose}">Registrar</button>`}
        </li>`;
      }).join("")}</ul>
    </section>

    ${used.length ? `<button class="link small" id="mk-used">${showUsed ? "Ocultar" : "Ver"} las ya usadas (${used.length})</button>
      ${showUsed ? `<ul class="bags" style="margin-top:6px">${used.slice(0, 60).map((b) => bagHtml(b, false)).join("")}</ul>` : ""}` : ""}`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-leche")) return;
  const q = (s) => e.target.closest(s);
  if (q("#mk-new")) return openBag(null, {});
  if (q("#mk-plan") || q("#mk-plan2")) return openPlan();
  if (q("#mk-used")) { showUsed = !showUsed; render(); return; }
  if (q("[data-reg]")) { const b = q("[data-reg]"); return openBag(null, { date: b.dataset.reg, place: b.dataset.purpose }); }
  if (q("[data-use]")) {
    const b = bags.find((x) => x.id === q("[data-use]").dataset.use);
    ctx.F.updateDoc(subDoc("milk", b.id), { used: true, usedAt: Date.now() }).then(() => toast(`Usada: ${b.ml} ml`)).catch(failed);
    return;
  }
  if (q("[data-freeze]")) {
    ctx.F.updateDoc(subDoc("milk", q("[data-freeze]").dataset.freeze), { place: "congelador" }).then(() => toast("Pasada al congelador")).catch(failed);
    return;
  }
  if (q("[data-bag]")) openBag(bags.find((x) => x.id === q("[data-bag]").dataset.bag));
});

function openBag(b, preset = {}) {
  editingId = b?.id || null;
  $("mk-title").textContent = b ? "Editar bolsa" : "Registrar extracción";
  $("mk-ml").value = b?.ml || plan().mlPerSession;
  $("mk-date").value = b?.date || preset.date || ymd();
  $("mk-time").value = b?.time || (preset.date ? "" : new Date().toTimeString().slice(0, 5));
  $("mk-place").value = b?.place || preset.place || (sessions().find((s) => s.date === ymd())?.purpose ?? "nevera");
  $("mk-notes").value = b?.notes || "";
  $("mk-delete").hidden = !b;
  $("dlg-milk").showModal();
}
$("mk-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const amount = Math.round(Number($("mk-ml").value));
  if (!(amount > 0)) { e.preventDefault(); return; }
  const data = { ml: amount, date: $("mk-date").value, time: $("mk-time").value, place: $("mk-place").value, notes: $("mk-notes").value.trim().slice(0, 120) };
  if (editingId) ctx.F.updateDoc(subDoc("milk", editingId), data).catch(failed);
  else ctx.F.addDoc(sub("milk"), { ...data, used: false, by: ctx.uid, createdAt: Date.now() })
    .then(() => toast(data.place === "congelador" ? `${amount} ml a la reserva` : `${amount} ml a la nevera`)).catch(failed);
  editingId = null;
});
$("mk-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("milk", editingId)).catch(failed);
  editingId = null;
  $("dlg-milk").close();
});

function openPlan() {
  const p = plan();
  $("mp2-start").value = p.start; $("mp2-work").value = p.workStart; $("mp2-time").value = p.time; $("mp2-ml").value = p.mlPerSession;
  $("mp2-bottles").value = p.bottles; $("mp2-mlb").value = p.mlBottle; $("mp2-goal").value = p.goalDays;
  document.querySelectorAll('input[name="mp2-wd"]').forEach((c) => (c.checked = p.weekdays.includes(Number(c.value))));
  document.querySelectorAll('input[name="mp2-rd"]').forEach((c) => (c.checked = p.reserveDays.includes(Number(c.value))));
  $("dlg-milkplan").showModal();
}
// Marcar un día como de reserva lo añade también a los días de extracción.
document.addEventListener("change", (e) => {
  if (e.target.name === "mp2-rd" && e.target.checked) { const w = document.querySelector(`input[name="mp2-wd"][value="${e.target.value}"]`); if (w) w.checked = true; }
  if (e.target.name === "mp2-wd" && !e.target.checked) { const r = document.querySelector(`input[name="mp2-rd"][value="${e.target.value}"]`); if (r) r.checked = false; }
});
$("mp2-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const pick = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => Number(c.value));
  const weekdays = pick("mp2-wd"), reserveDays = pick("mp2-rd").filter((d) => weekdays.includes(d));
  if (!weekdays.length) { e.preventDefault(); toast("Elige al menos un día de extracción"); return; }
  if ($("mp2-work").value <= $("mp2-start").value) { e.preventDefault(); toast("La vuelta al trabajo tiene que ser después del inicio"); return; }
  const n = (id, d, min, max) => Math.min(max, Math.max(min, Number($(id).value) || d));
  ctx.F.updateDoc(houseRef(), { milkPlan2: {
    start: $("mp2-start").value, workStart: $("mp2-work").value, weekdays, reserveDays, time: $("mp2-time").value || "10:00",
    mlPerSession: n("mp2-ml", 150, 10, 1000), bottles: n("mp2-bottles", 3, 1, 8), mlBottle: n("mp2-mlb", 150, 30, 300), goalDays: n("mp2-goal", 15, 1, 120),
  } }).then(() => toast("Plan guardado")).catch(failed);
});
