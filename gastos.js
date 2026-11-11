// Pestaña Gastos: lo que gastáis (tickets) y lo que compráis (historial de la lista).
import {
  ctx, $, esc, cap, norm, toast, failed, sub, subDoc, houseRef, stores, memberName,
  ymd, parseYmd, addDays, daysBetween, fmtDate, fmtMonth, euro, parseEuro,
  storeOptions, newStore, shrink, askGemini, AISLES,
} from "./core.js";
import { getCoupons } from "./cupones.js";

let purchases = [], tickets = [], unsubs = [];
let period = "mes"; // mes | trimestre | año
let showAllTickets = false;
let editingTicket = null;

const PERIODS = { mes: ["Este mes", 1], trimestre: ["3 meses", 3], año: ["12 meses", 12] };

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-ticket" class="sheet">
  <form method="dialog" id="t-form">
    <div class="photo-head">
      <img id="t-img" alt="" hidden>
      <div>
        <h2 id="t-title">Ticket</h2>
        <p class="muted" id="t-status"></p>
      </div>
    </div>
    <div class="row">
      <label class="field"><span>Tienda</span><select id="t-store"></select></label>
      <label class="field"><span>Fecha</span><input id="t-date" type="date" required></label>
    </div>
    <div class="row">
      <label class="field"><span>Total (€)</span><input id="t-total" inputmode="decimal" placeholder="0,00" required></label>
      <label class="field"><span>Nota</span><input id="t-note" maxlength="60" placeholder="Opcional"></label>
    </div>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="t-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save" id="t-save">Guardar</button>
    </div>
  </form>
</dialog>
<input type="file" id="t-photo" accept="image/*" hidden>`);

export function start() {
  stop();
  const since = Date.now() - 400 * 86400000;
  unsubs.push(ctx.F.onSnapshot(ctx.F.query(sub("purchases"), ctx.F.where("boughtAt", ">=", since)), (s) => {
    purchases = s.docs.map((d) => ({ id: d.id, ...d.data() })); render();
  }, (e) => console.error(e)));
  unsubs.push(ctx.F.onSnapshot(sub("tickets"), (s) => {
    tickets = s.docs.map((d) => ({ id: d.id, ...d.data() })); render();
  }, (e) => console.error(e)));
}
export function stop() { unsubs.forEach((u) => u()); unsubs = []; purchases = []; tickets = []; }
export function onHouse() { render(); }
export function onShow() { render(); }
ctx.onCoupons = () => { if (!$("view-gastos").hidden) render(); };

function periodStart() {
  const d = new Date(); d.setDate(1);
  d.setMonth(d.getMonth() - (PERIODS[period][1] - 1));
  return ymd(d);
}
function lastMonths(n) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setMonth(d.getMonth() - i); out.push(ymd(x).slice(0, 7)); }
  return out;
}
function bars(rows, { money = false, color } = {}) {
  const max = Math.max(...rows.map((r) => r.v), 0) || 1;
  return `<ul class="hbars">${rows.map((r) => `<li>
    <span class="hb-label">${esc(r.label)}</span>
    <span class="hb-track"><span class="hb-fill" style="width:${Math.max(2, (r.v / max) * 100)}%;${r.c || color ? `background:${r.c || color}` : ""}"></span></span>
    <span class="hb-val">${money ? euro(r.v) : r.v}</span></li>`).join("")}</ul>`;
}

function render() {
  const root = $("view-gastos");
  if (!root || !ctx.hid) return;
  const from = periodStart();
  const fromMs = parseYmd(from).getTime();
  const tk = tickets.filter((t) => t.date >= from).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const pu = purchases.filter((p) => p.boughtAt >= fromMs);
  const total = tk.reduce((s, t) => s + (t.total || 0), 0);
  const saved = getCoupons().filter((c) => c.used && c.usedAt >= fromMs).reduce((s, c) => s + (c.amount || 0), 0);

  // Gasto por mes
  const months = lastMonths(period === "año" ? 12 : 6);
  const byMonth = Object.fromEntries(months.map((m) => [m, 0]));
  for (const t of tickets) { const m = (t.date || "").slice(0, 7); if (m in byMonth) byMonth[m] += t.total || 0; }
  const maxM = Math.max(...Object.values(byMonth), 0) || 1;
  const thisMonth = ymd().slice(0, 7);
  const monthChart = `<div class="vbars" style="--n:${months.length}">${months.map((m) => `
    <div class="vb${m === thisMonth ? " now" : ""}" title="${esc(euro(byMonth[m]))}">
      <span class="vb-val">${byMonth[m] ? Math.round(byMonth[m]) + "€" : ""}</span>
      <span class="vb-bar" style="height:${(byMonth[m] / maxM) * 100}%"></span>
      <span class="vb-label">${fmtMonth(m + "-01")}</span>
    </div>`).join("")}</div>`;

  // Por tienda
  const byStore = {};
  for (const t of tk) { const k = t.store || "Sin tienda"; byStore[k] = (byStore[k] || 0) + (t.total || 0); }
  const storeRows = Object.entries(byStore).sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, v: Math.round(v * 100) / 100 }));

  // Lo que más compráis (sobre el último año, para que las frecuencias tengan sentido)
  const groups = {};
  for (const p of purchases) { const k = norm(p.name); (groups[k] ||= { name: p.name, dates: [] }).dates.push(p.boughtAt); }
  const top = Object.values(groups).map((g) => {
    g.dates.sort((a, b) => a - b);
    const n = g.dates.length;
    const every = n > 1 ? Math.round((g.dates[n - 1] - g.dates[0]) / 86400000 / (n - 1)) : null;
    const last = ymd(new Date(g.dates[n - 1]));
    return { ...g, n, every, last };
  }).sort((a, b) => b.n - a.n).slice(0, 10);

  // Por sección (en el periodo)
  const byAisle = {};
  for (const p of pu) byAisle[p.aisle || "otros"] = (byAisle[p.aisle || "otros"] || 0) + 1;
  const aisleRows = AISLES.filter((a) => byAisle[a.id]).map((a) => ({ label: a.name, v: byAisle[a.id], c: a.c })).sort((a, b) => b.v - a.v);

  const ticketList = (showAllTickets ? tk : tk.slice(0, 6)).map((t) => `
    <li class="tk" data-ticket="${esc(t.id)}" tabindex="0" role="button">
      <span class="tk-date">${esc(fmtDate(t.date))}</span>
      <span class="tk-store">${esc(t.store || "Sin tienda")}${t.note ? `<small>${esc(t.note)}</small>` : ""}</span>
      <span class="tk-total">${euro(t.total)}</span>
    </li>`).join("");

  root.innerHTML = `
    <div class="view-head">
      <h1>Gastos</h1>
      <div class="seg" role="tablist">${Object.entries(PERIODS).map(([k, [l]]) => `<button role="tab" data-period="${k}" aria-selected="${period === k}">${l}</button>`).join("")}</div>
    </div>

    <div class="ticket-actions">
      <button class="btn" id="g-photo"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/></svg> Foto del ticket</button>
      <button class="btn ghost" id="g-manual">Apuntar a mano</button>
    </div>

    <div class="kpis">
      <div class="kpi"><span class="kpi-label">Gastado</span><span class="kpi-val">${euro(total)}</span></div>
      <div class="kpi"><span class="kpi-label">Tickets</span><span class="kpi-val">${tk.length}</span></div>
      <div class="kpi"><span class="kpi-label">Media por compra</span><span class="kpi-val">${tk.length ? euro(total / tk.length) : "—"}</span></div>
      <div class="kpi"><span class="kpi-label">Ahorrado con cupones</span><span class="kpi-val saved">${euro(saved)}</span></div>
    </div>

    ${tickets.length ? `<section class="panel"><h2>Gasto por mes</h2>${monthChart}</section>` : ""}
    ${storeRows.length ? `<section class="panel"><h2>Por supermercado</h2>${bars(storeRows, { money: true, color: "var(--store-fg)" })}</section>` : ""}

    <section class="panel">
      <h2>Tickets</h2>
      ${tk.length ? `<ul class="tickets">${ticketList}</ul>${tk.length > 6 ? `<button class="link" id="g-more">${showAllTickets ? "Ver menos" : `Ver los ${tk.length}`}</button>` : ""}`
        : `<p class="muted">Aún no hay tickets en este periodo. Al volver del súper, haz una foto al ticket y BRETONA apunta la tienda, la fecha y el total.</p>`}
    </section>

    <section class="panel">
      <h2>Lo que más compráis</h2>
      ${top.length ? `<ol class="top">${top.map((g) => `<li>
          <span class="top-name">${esc(g.name)}</span>
          <span class="top-meta">${g.every ? `cada ${g.every} ${g.every === 1 ? "día" : "días"} · ` : ""}última ${esc(fmtDate(g.last))}</span>
          <span class="top-n">${g.n}×</span></li>`).join("")}</ol>`
        : `<p class="muted">Se rellena solo: cada producto que marcáis como comprado en la lista queda apuntado aquí.</p>`}
    </section>

    ${aisleRows.length ? `<section class="panel"><h2>Por sección · ${esc(PERIODS[period][0].toLowerCase())}</h2>${bars(aisleRows)}</section>` : ""}
  `;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-gastos")) return;
  const per = e.target.closest("[data-period]");
  if (per) { period = per.dataset.period; render(); return; }
  if (e.target.closest("#g-photo")) { $("t-photo").click(); return; }
  if (e.target.closest("#g-manual")) { openTicket(null); return; }
  if (e.target.closest("#g-more")) { showAllTickets = !showAllTickets; render(); return; }
  const t = e.target.closest("[data-ticket]");
  if (t) openTicket(tickets.find((x) => x.id === t.dataset.ticket));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.("#view-gastos [data-ticket]")) e.target.click();
});

function openTicket(t, { fromPhoto = false } = {}) {
  editingTicket = t?.id || null;
  $("t-title").textContent = t ? "Editar ticket" : fromPhoto ? "Ticket desde foto" : "Nuevo ticket";
  $("t-status").textContent = "";
  $("t-img").hidden = !fromPhoto;
  $("t-store").innerHTML = storeOptions(t?.store || "", { any: "Sin tienda" });
  $("t-date").value = t?.date || ymd();
  $("t-total").value = t?.total != null ? String(t.total).replace(".", ",") : "";
  $("t-note").value = t?.note || "";
  $("t-delete").hidden = !t;
  $("t-save").disabled = false;
  if (!$("dlg-ticket").open) $("dlg-ticket").showModal();
}
$("t-store").addEventListener("change", async (e) => {
  if (e.target.value === "__new") { const s = await newStore(); e.target.innerHTML = storeOptions(s, { any: "Sin tienda" }); }
});
$("t-delete").addEventListener("click", () => {
  if (editingTicket) ctx.F.deleteDoc(subDoc("tickets", editingTicket)).catch(failed);
  editingTicket = null;
  $("dlg-ticket").close("deleted");
});
$("t-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const total = parseEuro($("t-total").value);
  if (total == null || total < 0) { e.preventDefault(); $("t-status").textContent = "Escribe el total, por ejemplo 45,30."; $("t-total").focus(); return; }
  const store = $("t-store").value === "__new" ? "" : $("t-store").value;
  const data = { store, date: $("t-date").value || ymd(), total, note: cap($("t-note").value).slice(0, 60) };
  if (store && !stores().includes(store)) ctx.F.updateDoc(houseRef(), { stores: ctx.F.arrayUnion(store) }).catch(() => {});
  if (editingTicket) ctx.F.updateDoc(subDoc("tickets", editingTicket), data).catch(failed);
  else ctx.F.addDoc(sub("tickets"), { ...data, addedBy: ctx.uid, createdAt: Date.now() }).then(() => toast(`Ticket guardado: ${euro(total)}`)).catch(failed);
  editingTicket = null;
});

const TICKET_PROMPT = `Esta imagen es un ticket de compra de un supermercado o tienda en España.
Responde SOLO con JSON con esta forma exacta:
{"tienda":"Mercadona","fecha":"2026-11-08","total":45.3}
Reglas:
- "tienda": el nombre comercial (Mercadona, Lidl, Carrefour, Dia, Alcampo, Eroski, Consum, Aldi...), no la razón social.
- "fecha": en formato AAAA-MM-DD. Si no se ve, "".
- "total": el importe TOTAL pagado, como número con punto decimal. Si no se ve, null.
- Tiendas que ya usa esta familia: ${"{TIENDAS}"}. Si es una de ellas, escríbela exactamente igual.`;

$("t-photo").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  openTicket(null, { fromPhoto: true });
  $("t-save").disabled = true;
  $("t-status").innerHTML = `<span class="spinner"></span>Leyendo el ticket…`;
  let img;
  try { img = await shrink(file, 2000); $("t-img").src = img.preview; }
  catch { $("t-status").textContent = "No se puede abrir esta imagen. Prueba con otra foto."; $("t-save").disabled = false; return; }
  try {
    const d = await askGemini(TICKET_PROMPT.replace("{TIENDAS}", stores().join(", ") || "ninguna"), img.base64);
    if (!$("dlg-ticket").open) return;
    if (!d) throw new Error("No he sabido leer el ticket. Rellena los datos a mano.");
    let store = cap(d.tienda || "");
    const known = stores().find((s) => norm(s) === norm(store) || (store && norm(store).includes(norm(s))));
    if (known) store = known;
    $("t-store").innerHTML = storeOptions(store, { any: "Sin tienda" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || "") && Math.abs(daysBetween(d.fecha, ymd())) < 400) $("t-date").value = d.fecha;
    const tot = typeof d.total === "number" ? d.total : parseEuro(d.total);
    if (tot != null) $("t-total").value = String(tot.toFixed(2)).replace(".", ",");
    $("t-status").textContent = "Revisa los datos y pulsa Guardar.";
  } catch (err) {
    if ($("dlg-ticket").open) $("t-status").textContent = err.message + " Puedes rellenarlo a mano.";
  }
  $("t-save").disabled = false;
});
