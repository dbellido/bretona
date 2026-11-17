// Pestaña de crecimiento: percentiles de la OMS de peso, longitud y perímetro de cabeza,
// gráfica con las curvas y estimación de las medidas cada día 7 de mes.
import { ctx, $, esc, cap, toast, failed, sub, subDoc, houseRef, ymd, addDays, parseYmd, daysBetween, fmtDate, fmtDay, LS } from "./core.js";
import { WHO } from "./crecimiento-oms.js";

let rows = [], unsub = null, editingId = null;
let ind = LS.get("bretona.growind") || "peso";

const IND = {
  peso: { label: "Peso", unit: "kg", dec: 2, min: 1.5, max: 30, field: "weight" },
  talla: { label: "Longitud", unit: "cm", dec: 1, min: 40, max: 120, field: "length" },
  cabeza: { label: "Cabeza", unit: "cm", dec: 1, min: 28, max: 56, field: "head" },
};
const PCTS = [[-1.881, "P3"], [-1.036, "P15"], [0, "P50"], [1.036, "P85"], [1.881, "P97"]];
const child = () => ({ name: "Gael", birth: "2026-07-07", sex: "", ...(ctx.house?.child || {}) });
const fmtN = (n, d) => n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------- Cálculo OMS (método LMS) ---------- */
const ageMonths = (date) => daysBetween(child().birth, date) / 30.4375;
function lms(indicator, months) {
  const t = WHO[indicator][child().sex];
  const m = Math.max(0, Math.min(60, months)), i = Math.min(59, Math.floor(m)), f = m - i;
  return t[i].map((v, k) => v + (t[i + 1][k] - v) * f);
}
const valueAt = ([L, M, S], z) => (L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L));
function zScore(indicator, months, x) {
  const [L, M, S] = lms(indicator, months);
  let z = L === 0 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S);
  // Ajuste de la OMS para valores extremos (peso y cabeza).
  if (indicator !== "talla" && Math.abs(z) > 3) {
    const sd3 = valueAt([L, M, S], 3 * Math.sign(z)), sd2 = valueAt([L, M, S], 2 * Math.sign(z));
    z = 3 * Math.sign(z) + (x - sd3) / Math.abs(sd3 - sd2);
  }
  return z;
}
// Función de distribución normal (para pasar de z a percentil).
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const pct = (z) => { const p = phi(z) * 100; return p < 1 ? "<P1" : p > 99 ? ">P99" : "P" + Math.round(p); };

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-growth" class="sheet">
  <form method="dialog" id="gr-form">
    <h2 id="gr-title">Nueva medida</h2>
    <label class="field"><span>Día</span><input id="gr-date" type="date" required></label>
    <div class="row">
      <label class="field"><span>Peso (kg)</span><input id="gr-weight" inputmode="decimal" placeholder="6,8"></label>
      <label class="field"><span>Longitud (cm)</span><input id="gr-length" inputmode="decimal" placeholder="64"></label>
      <label class="field"><span>Cabeza (cm)</span><input id="gr-head" inputmode="decimal" placeholder="42"></label>
    </div>
    <p class="muted small-print">Basta con el peso. Puedes escribirlo en kilos (6,8) o en gramos (6800).</p>
    <label class="field"><span>Notas</span><input id="gr-notes" maxlength="120" placeholder="Revisión del pediatra, báscula de casa…"></label>
    <p class="note" id="gr-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="gr-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-child" class="sheet">
  <form method="dialog" id="ch-form">
    <h2>Datos del bebé</h2>
    <div class="row">
      <label class="field"><span>Nombre</span><input id="ch-name" maxlength="30" required></label>
      <label class="field"><span>Nació el</span><input id="ch-birth" type="date" required></label>
    </div>
    <label class="field"><span>Tablas de la OMS</span><select id="ch-sex" required><option value="">Elige…</option><option value="niño">Niño</option><option value="niña">Niña</option></select></label>
    <p class="muted small-print">La OMS tiene curvas distintas para niños y niñas.</p>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("growth"), (s) => { rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.date.localeCompare(b.date)); render(); }, (e) => console.error(e));
  updateTabLabel();
}
export function stop() { unsub?.(); unsub = null; rows = []; }
export function onShow() { render(); }
export function onHouse() { updateTabLabel(); render(); }
function updateTabLabel() { const el = document.querySelector('#dlg-more [data-view="crecimiento"] span'); if (el) el.textContent = child().name || "Crecimiento"; }

/* ---------- Estimación: mismo percentil que en la última medida ---------- */
function lastZ(indicator) {
  const r = [...rows].reverse().find((x) => x[IND[indicator].field]);
  return r ? { z: zScore(indicator, ageMonths(r.date), r[IND[indicator].field]), date: r.date } : null;
}
function nextSevenths(n = 12) {
  const out = [], d = new Date(); let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() > 7) m++;
  for (let i = 0; i < n; i++) { const x = new Date(y, m + i, 7); out.push(ymd(x)); }
  return out.filter((s) => ageMonths(s) <= 60);
}

/* ---------- Gráfica ---------- */
function chart(indicator) {
  const c = child(), now = ageMonths(ymd());
  const x0 = 0, x1 = Math.min(60, Math.max(6, Math.ceil(now) + 6));
  const W = 360, H = 250, padL = 38, padR = 34, padT = 12, padB = 30;
  const step = (x1 - x0) / 60;
  const xs = Array.from({ length: 61 }, (_, i) => x0 + i * step);
  const curves = PCTS.map(([z, name]) => ({ name, z, pts: xs.map((m) => [m, valueAt(lms(indicator, m), z)]) }));
  const yMin = Math.min(...curves[0].pts.map((p) => p[1])), yMax = Math.max(...curves[4].pts.map((p) => p[1]));
  const yPad = (yMax - yMin) * 0.05;
  const lo = yMin - yPad, hi = yMax + yPad;
  const X = (m) => padL + ((m - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
  const band = path(curves[1].pts) + curves[3].pts.slice().reverse().map((p) => "L" + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("") + "Z";
  // Ejes: un tick por mes (o cada 2/3 si hay muchos) y 4-5 valores en vertical.
  const every = x1 - x0 > 14 ? 3 : x1 - x0 > 8 ? 2 : 1;
  const xt = []; for (let m = Math.ceil(x0); m <= x1; m += every) xt.push(m);
  const span = hi - lo, raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const yStep = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= 6);
  const yt = []; for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) yt.push(v);
  const f = IND[indicator].field;
  const meas = rows.filter((r) => r[f]).map((r) => ({ m: ageMonths(r.date), v: r[f], date: r.date, z: zScore(indicator, ageMonths(r.date), r[f]) })).filter((p) => p.m >= x0 && p.m <= x1);
  const lz = lastZ(indicator);
  const proj = lz ? [{ m: ageMonths(lz.date), v: valueAt(lms(indicator, ageMonths(lz.date)), lz.z) }, ...nextSevenths(12).map((d) => ({ m: ageMonths(d), v: valueAt(lms(indicator, ageMonths(d)), lz.z), date: d }))].filter((p) => p.m <= x1) : [];
  const unit = IND[indicator].unit;
  return `<svg class="growth-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Curvas de ${IND[indicator].label.toLowerCase()} de la OMS con las medidas de ${esc(c.name)}">
    ${yt.map((v) => `<line class="gc-grid" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="gc-tick" x="${padL - 6}" y="${Y(v) + 3.5}" text-anchor="end">${fmtN(v, v % 1 ? 1 : 0)}</text>`).join("")}
    ${xt.map((m) => `<text class="gc-tick" x="${X(m)}" y="${H - padB + 14}" text-anchor="middle">${m}</text>`).join("")}
    <text class="gc-axis" x="${W - padR}" y="${H - 4}" text-anchor="end">meses</text>
    <text class="gc-axis" x="4" y="${padT + 2}" dominant-baseline="hanging">${unit}</text>
    <path class="gc-band" d="${band}"/>
    ${curves.map((cv) => `<path class="gc-line${cv.name === "P50" ? " mid" : ""}" d="${path(cv.pts)}"/><text class="gc-lab" x="${W - padR + 4}" y="${Y(cv.pts[60][1]) + 3.5}">${cv.name}</text>`).join("")}
    <line class="gc-today" x1="${X(now)}" x2="${X(now)}" y1="${padT}" y2="${H - padB}"/>
    ${proj.length > 1 ? `<path class="gc-proj" d="${path(proj.map((p) => [p.m, p.v]))}"/>${proj.slice(1).map((p) => `<circle class="gc-proj-dot" cx="${X(p.m)}" cy="${Y(p.v)}" r="3"/><circle class="gc-hit" cx="${X(p.m)}" cy="${Y(p.v)}" r="11" data-tip="Estimación ${esc(fmtDay(p.date))}: ${fmtN(p.v, IND[indicator].dec)} ${unit} (${pct(lz.z)})"/>`).join("")}` : ""}
    ${meas.length > 1 ? `<path class="gc-child" d="${path(meas.map((p) => [p.m, p.v]))}"/>` : ""}
    ${meas.map((p) => `<circle class="gc-dot" cx="${X(p.m)}" cy="${Y(p.v)}" r="4.5"/><circle class="gc-hit" cx="${X(p.m)}" cy="${Y(p.v)}" r="12" data-tip="${esc(fmtDate(p.date))}: ${fmtN(p.v, IND[indicator].dec)} ${unit} · ${pct(p.z)}"/>`).join("")}
  </svg>`;
}

/* ---------- Pintar ---------- */
function ageText(date) {
  const b = parseYmd(child().birth), d = parseYmd(date);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth();
  if (d.getDate() < b.getDate()) months--;
  const anchor = new Date(b); anchor.setMonth(b.getMonth() + months);
  const days = Math.round((d - anchor) / 86400000);
  if (!months && !days) return "Al nacer";
  if (!months) return `${days} ${days === 1 ? "día" : "días"}`;
  return `${months} ${months === 1 ? "mes" : "meses"}${days ? ` y ${days} ${days === 1 ? "día" : "días"}` : ""}`;
}
function chip(indicator, r) {
  const f = IND[indicator].field; if (!r[f]) return "";
  const z = zScore(indicator, ageMonths(r.date), r[f]);
  const out = z < -1.881 || z > 1.881;
  return `<span class="gm${out ? " out" : ""}"><b>${fmtN(r[f], IND[indicator].dec)} ${IND[indicator].unit}</b> ${IND[indicator].label.toLowerCase()} · ${pct(z)}</span>`;
}

function render() {
  const root = $("view-crecimiento");
  if (!root || !ctx.hid) return;
  const c = child();
  if (!c.sex || !c.birth) {
    root.innerHTML = `<div class="view-head"><h1>Crecimiento</h1></div>
      <div class="card"><h2>Antes de empezar</h2><p class="muted">Para calcular los percentiles con las tablas de la OMS necesito el nombre, la fecha de nacimiento y si son las tablas de niño o de niña.</p>
      <button class="btn" id="gr-child">Completar datos</button></div>`;
    return;
  }
  const last = rows[rows.length - 1];
  const has = Object.keys(IND).filter((k) => rows.some((r) => r[IND[k].field]));
  if (!has.includes(ind) && has.length) ind = has[0];
  const sevenths = nextSevenths(12);
  const est = has.map((k) => ({ k, lz: lastZ(k) }));
  root.innerHTML = `
    <div class="view-head"><h1>${esc(c.name)}</h1><button class="btn" id="gr-new">Nueva medida</button></div>
    <p class="muted growth-age">${esc(ageText(ymd()))} · nació el ${esc(fmtDate(c.birth))} <button class="link small" id="gr-child">Cambiar</button></p>

    ${last ? `<section class="growth-last">
      <span class="kpi-label">Última medida · ${esc(fmtDate(last.date))} (${esc(ageText(last.date))})</span>
      <div class="gm-row">${Object.keys(IND).map((k) => chip(k, last)).join("")}</div>
      ${Object.keys(IND).some((k) => { const f = IND[k].field; if (!last[f]) return false; const z = zScore(k, ageMonths(last.date), last[f]); return z < -1.881 || z > 1.881; })
        ? `<p class="small-print note">Alguna medida está por debajo del P3 o por encima del P97. No tiene por qué ser un problema; lo importante es que siga su curva. Coméntalo con el pediatra.</p>` : ""}
    </section>` : `<div class="empty"><strong>Sin medidas todavía</strong>Apunta el peso (y si lo tienes, la longitud y la cabeza) y verás su percentil según la OMS.</div>`}

    ${has.length ? `
    <div class="seg wide" role="tablist">${Object.entries(IND).map(([k, v]) => `<button role="tab" data-gind="${k}" aria-selected="${ind === k}" ${has.includes(k) ? "" : "disabled"}>${v.label}</button>`).join("")}</div>
    <section class="panel chart-panel">
      ${chart(ind)}
      <p class="gc-tip muted small-print" id="gr-tip">Toca un punto para ver su valor. Línea discontinua: estimación si sigue en su percentil.</p>
    </section>

    <section class="panel">
      <h2>Estimación el día 7 de cada mes</h2>
      <p class="muted small-print">Suponiendo que sigue en el mismo percentil que en la última medida (${est.map(({ k, lz }) => `${IND[k].label.toLowerCase()} ${pct(lz.z)}`).join(", ")}). Es orientativo: los bebés cambian de percentil con frecuencia.</p>
      <div class="table-wrap"><table class="est">
        <thead><tr><th>Día</th><th>Edad</th>${est.map(({ k }) => `<th>${{ peso: "Peso", talla: "Long.", cabeza: "Cabeza" }[k]}<small> ${IND[k].unit}</small></th>`).join("")}</tr></thead>
        <tbody>${sevenths.map((d) => `<tr><td>${esc(fmtDay(d))}</td><td>${Math.round(ageMonths(d))} m</td>${est.map(({ k, lz }) => `<td>${fmtN(valueAt(lms(k, ageMonths(d)), lz.z), 1)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
    </section>` : ""}

    ${rows.length ? `<section class="panel"><h2>Medidas</h2><ul class="gm-list">${[...rows].reverse().map((r) => `<li>
        <span class="gm-date">${esc(fmtDate(r.date))}<small>${esc(ageText(r.date))}</small></span>
        <span class="gm-vals">${Object.keys(IND).map((k) => chip(k, r)).join("")}${r.notes ? `<small class="muted">${esc(r.notes)}</small>` : ""}</span>
        <button class="more" data-gr="${esc(r.id)}" aria-label="Editar medida">•••</button></li>`).join("")}</ul></section>` : ""}

    <p class="muted small-print">Patrones de crecimiento infantil de la OMS (2006), los mismos que usan las gráficas del pediatra de 0 a 5 años. Esta pestaña es orientativa y no sustituye la revisión médica.</p>`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-crecimiento")) return;
  const q = (s) => e.target.closest(s);
  if (q("#gr-new")) return openRow(null);
  if (q("#gr-child")) return openChild();
  if (q("[data-gind]")) { ind = q("[data-gind]").dataset.gind; LS.set("bretona.growind", ind); render(); return; }
  if (q("[data-gr]")) return openRow(rows.find((r) => r.id === q("[data-gr]").dataset.gr));
  const hit = q("[data-tip]");
  if (hit) $("gr-tip").textContent = hit.dataset.tip;
});
document.addEventListener("pointerover", (e) => {
  const hit = e.target.closest?.("#view-crecimiento [data-tip]");
  if (hit && $("gr-tip")) $("gr-tip").textContent = hit.dataset.tip;
});

const num = (v) => { const n = parseFloat(String(v || "").replace(",", ".")); return isFinite(n) && n > 0 ? n : null; };
function openRow(r) {
  editingId = r?.id || null;
  $("gr-title").textContent = r ? "Editar medida" : "Nueva medida";
  $("gr-date").value = r?.date || ymd();
  const show = (v) => (v ? String(v).replace(".", ",") : "");
  $("gr-weight").value = show(r?.weight); $("gr-length").value = show(r?.length); $("gr-head").value = show(r?.head);
  $("gr-notes").value = r?.notes || ""; $("gr-msg").textContent = "";
  $("gr-delete").hidden = !r;
  $("dlg-growth").showModal();
}
$("gr-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  let weight = num($("gr-weight").value);
  if (weight && weight > 100) weight = weight / 1000; // escrito en gramos
  const length = num($("gr-length").value), head = num($("gr-head").value);
  const bad = (v, k) => v && (v < IND[k].min || v > IND[k].max);
  const date = $("gr-date").value;
  if (!weight && !length && !head) { e.preventDefault(); $("gr-msg").textContent = "Escribe al menos el peso."; return; }
  if (bad(weight, "peso") || bad(length, "talla") || bad(head, "cabeza")) { e.preventDefault(); $("gr-msg").textContent = "Algún valor parece fuera de rango. Revisa las unidades (kg y cm)."; return; }
  if (date < child().birth || date > ymd()) { e.preventDefault(); $("gr-msg").textContent = "La fecha tiene que estar entre el nacimiento y hoy."; return; }
  const data = { date, weight: weight ? Math.round(weight * 1000) / 1000 : null, length, head, notes: $("gr-notes").value.trim().slice(0, 120) };
  if (editingId) ctx.F.updateDoc(subDoc("growth", editingId), data).catch(failed);
  else ctx.F.addDoc(sub("growth"), { ...data, by: ctx.uid, createdAt: Date.now() }).then(() => {
    const z = weight ? zScore("peso", ageMonths(date), weight) : null;
    toast(z != null ? `Guardado: ${fmtN(weight, 2)} kg · ${pct(z)}` : "Medida guardada");
  }).catch(failed);
  editingId = null;
});
$("gr-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("growth", editingId)).catch(failed);
  editingId = null;
  $("dlg-growth").close();
});
function openChild() {
  const c = child();
  $("ch-name").value = c.name; $("ch-birth").value = c.birth; $("ch-sex").value = c.sex;
  $("dlg-child").showModal();
}
$("ch-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  ctx.F.updateDoc(houseRef(), { child: { name: cap($("ch-name").value).slice(0, 30), birth: $("ch-birth").value, sex: $("ch-sex").value } })
    .then(() => toast("Datos guardados")).catch(failed);
});
