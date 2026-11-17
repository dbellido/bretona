// Pestaña Recambios: pañales, esponjas, bolsas, gasas, empapadores…
// Stock en el armario y en uso, consumo diario, suscripciones y aviso de cuándo pedir.
import { ctx, $, esc, cap, toast, failed, sub, subDoc, ymd, addDays, daysBetween, fmtDate, fmtDay, relDay, safeUrl } from "./core.js";
import { growthApi } from "./crecimiento.js";

let list = [], unsub = null, editingId = null, adjustingId = null;

// Tallas de pañal por peso (las más habituales en España; cada marca varía un poco).
const DIAPER_SIZES = [
  { t: "1", from: 2, to: 5 }, { t: "2", from: 3, to: 6 }, { t: "3", from: 5, to: 10 },
  { t: "4", from: 9, to: 14 }, { t: "5", from: 11, to: 16 }, { t: "6", from: 13, to: 18 },
];
// Talla aconsejada: la primera en la que todavía le queda al menos 1 kg de margen.
const sizeForWeight = (kg) => DIAPER_SIZES.find((s) => kg >= s.from && kg <= s.to - 1) || DIAPER_SIZES.find((s) => kg <= s.to) || DIAPER_SIZES[DIAPER_SIZES.length - 1];

// Los recambios que nos contaron, con un consumo orientativo para empezar (se cambia en •••).
const STARTERS = [
  { name: "Pañales", unit: "pañales", daily: 7, pack: 0, diaper: true },
  { name: "Esponjas jabonosas", unit: "esponjas", daily: 1, pack: 0 },
  { name: "Bolsas de basura para pañales", unit: "recambios", daily: 0.05, pack: 0 },
  { name: "Gasas", unit: "gasas", daily: 2, pack: 0 },
  { name: "Empapadores", unit: "empapadores", daily: 1, pack: 0 },
];
const MARGIN = 3; // días de margen antes de quedarse sin nada

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-supply" class="sheet">
  <form method="dialog" id="sp-form">
    <h2 id="sp-title">Nuevo recambio</h2>
    <div class="row">
      <label class="field"><span>Qué es</span><input id="sp-name" maxlength="50" required placeholder="Pañales"></label>
      <label class="field" style="flex:0 0 120px"><span>Se cuenta en</span><input id="sp-unit" maxlength="20" placeholder="pañales"></label>
    </div>
    <div class="row">
      <label class="field"><span>Se gastan al día</span><input id="sp-daily" inputmode="decimal" placeholder="7"></label>
      <label class="field"><span>Unidades por paquete</span><input id="sp-pack" inputmode="numeric" placeholder="44"></label>
    </div>
    <p class="muted small-print">Si se gasta menos de uno al día, pon decimales: una bolsa cada 20 días = 0,05.</p>
    <label class="check-row" id="sp-diaper-row"><input type="checkbox" id="sp-diaper"> Son pañales (calcular la talla por el peso del bebé)</label>
    <label class="field" id="sp-size-row"><span>Talla actual</span><select id="sp-size"><option value="">—</option>${DIAPER_SIZES.map((s) => `<option value="${s.t}">Talla ${s.t} (${s.from}-${s.to} kg)</option>`).join("")}</select></label>
    <fieldset class="sp-sub"><legend>Suscripción o pedido habitual</legend>
      <label class="check-row"><input type="checkbox" id="sp-has-sub"> Llega cada cierto tiempo</label>
      <div class="row sp-subf">
        <label class="field"><span>Cada (semanas)</span><input id="sp-every" type="number" min="1" max="52" placeholder="4"></label>
        <label class="field"><span>Unidades por pedido</span><input id="sp-qty" inputmode="numeric" placeholder="160"></label>
      </div>
      <div class="row sp-subf">
        <label class="field"><span>Próximo pedido</span><input id="sp-next" type="date"></label>
        <label class="field"><span>Tienda</span><input id="sp-store" maxlength="40" placeholder="Amazon, Dodot…"></label>
      </div>
      <label class="field sp-subf"><span>Enlace para gestionar la suscripción</span><input id="sp-link" type="url" maxlength="400" placeholder="https://…"></label>
    </fieldset>
    <p class="note" id="sp-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="sp-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-adjust" class="sheet">
  <form method="dialog" id="aj-form">
    <h2 id="aj-title">¿Cuántos hay?</h2>
    <p class="muted small-print">Cuenta lo que hay ahora. La app sigue descontando a partir de aquí.</p>
    <div class="row">
      <label class="field"><span>En el armario (sin abrir)</span><input id="aj-stock" type="number" min="0" inputmode="numeric"></label>
      <label class="field"><span>En uso (abiertos)</span><input id="aj-inuse" type="number" min="0" inputmode="numeric"></label>
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
  unsub = ctx.F.onSnapshot(sub("supplies"), (s) => {
    list = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
    render(); ctx.onSupplies?.();
  }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; list = []; }
export function onShow() { render(); }
export function onHouse() { render(); }

/* ---------- Cálculos ---------- */
// Lo que se ha gastado desde la última vez que se contó: primero de lo abierto, luego del armario.
function now(x) {
  const used = Math.max(0, (Number(x.daily) || 0) * Math.max(0, daysBetween(x.countedOn || ymd(), ymd())));
  let inUse = Number(x.inUse) || 0, stock = Number(x.stock) || 0;
  const fromInUse = Math.min(inUse, used); inUse -= fromInUse;
  stock = Math.max(0, stock - (used - fromInUse));
  const total = inUse + stock;
  const days = x.daily ? total / x.daily : Infinity;
  const untilNext = x.sub && x.next ? Math.max(0, daysBetween(ymd(), x.next)) : null;
  // Si hay suscripción, tiene que llegar hasta el próximo pedido; si no, avisamos con una semana.
  const need = untilNext != null ? untilNext + MARGIN : 7;
  const status = x.counted === false ? "unset" : !x.daily ? "ok" : days < need - MARGIN || days < 2 ? "now" : days < need + 4 ? "soon" : "ok";
  return { inUse: Math.round(inUse), stock: Math.round(stock), total: Math.round(total), days, untilNext, status };
}
export const urgentCount = () => list.filter((x) => now(x).status === "now").length;
const fmtQty = (n, unit) => `${Math.round(n).toLocaleString("es-ES")} ${unit || ""}`.trim();
const fmtDays = (d) => (d === Infinity ? "" : d < 1 ? "se acaban hoy" : d < 14 ? `para ${Math.floor(d)} ${Math.floor(d) === 1 ? "día" : "días"}` : `para unas ${Math.round(d / 7)} semanas`);

/* ---------- Pañales: talla por el peso ---------- */
function diaperHtml(x) {
  const last = growthApi.lastWeight();
  if (!last) return `<p class="small-print muted">Apunta el peso en Crecimiento y aquí te diré qué talla le toca y cuándo cambiarla.</p>`;
  const cur = sizeForWeight(last.weight);
  const name = growthApi.child().name || "el bebé";
  // ¿Cuándo llegará al tope (con 1 kg de margen) de la talla aconsejada? Según su curva de peso.
  let change = null;
  if (growthApi.weightAt(ymd()) != null) {
    for (let i = 1; i <= 365; i++) { const d = addDays(ymd(), i); if (growthApi.weightAt(d) > cur.to - 1) { change = d; break; } }
  }
  const nxt = DIAPER_SIZES[DIAPER_SIZES.indexOf(cur) + 1];
  const mismatch = x.size && x.size !== cur.t;
  return `<div class="diaper${mismatch ? " warn" : ""}">
    <span>Con <b>${last.weight.toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg</b> (${esc(fmtDate(last.date))}) le toca la <b>talla ${cur.t}</b> (${cur.from}-${cur.to} kg)${x.size ? ` · tenéis la talla ${esc(x.size)}` : ""}.</span>
    ${mismatch ? `<span class="small-print"><b>${Number(x.size) < Number(cur.t) ? "Toca subir de talla" : "La talla de la suscripción es mayor de lo que le toca"}.</b> Cambiadla en la suscripción.</span>` : ""}
    ${change && nxt ? `<span class="small-print">Si sigue su curva, pasará a la <b>talla ${nxt.t}</b> hacia el <b>${esc(fmtDate(change))}</b> (${esc(relDay(change).toLowerCase())}). Acordaos de cambiar la suscripción antes.</span>` : ""}
  </div>`;
}

/* ---------- Pintar ---------- */
function cardHtml(x) {
  const n = now(x);
  const arrived = x.sub && x.next && x.next <= ymd();
  const coverPct = n.untilNext != null && n.days !== Infinity ? Math.min(100, (n.days / Math.max(1, n.untilNext + MARGIN)) * 100) : null;
  const packs = x.pack ? ` · ${(n.stock / x.pack).toLocaleString("es-ES", { maximumFractionDigits: 1 })} paquetes` : "";
  const link = safeUrl(x.link);
  return `<li class="supply st-${n.status}" data-id="${esc(x.id)}">
    <div class="sp-head">
      <span class="sp-name">${esc(x.name)}${x.size ? ` <span class="sp-size">talla ${esc(x.size)}</span>` : ""}</span>
      <span class="sp-chip ${n.status}">${n.status === "now" ? "Pedir ya" : n.status === "soon" ? "Pedir pronto" : n.status === "unset" ? "Sin contar" : "Bien"}</span>
    </div>
    <div class="sp-main">
      <span class="sp-total">${fmtQty(n.total, x.unit)}</span>
      ${n.status === "unset" ? `<span class="muted small-print">Pulsa «Ajustar» y pon cuántos tenéis</span>` : n.days !== Infinity ? `<span class="muted"><b>${fmtDays(n.days)}</b></span>` : `<span class="muted small-print">Pon cuántos se gastan al día en •••</span>`}
    </div>
    ${coverPct != null ? `<div class="sp-bar" role="img" aria-label="Cubre el ${Math.round(coverPct)}% hasta el próximo pedido"><span style="width:${coverPct}%"></span></div>` : ""}
    <span class="small-print muted">En el armario: <b>${fmtQty(n.stock, "")}</b>${packs} · En uso: <b>${fmtQty(n.inUse, "")}</b>${x.daily ? ` · se gastan ~${String(x.daily).replace(".", ",")} al día` : ""}</span>
    ${x.sub ? `<span class="small-print">${x.store ? esc(x.store) + " · " : ""}cada ${x.every} ${x.every === 1 ? "semana" : "semanas"}${x.qty ? ` · ${fmtQty(x.qty, x.unit)}` : ""}${x.next ? ` · próximo pedido <b>${esc(fmtDay(x.next))}</b>` : ""}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">Gestionar</a>` : ""}</span>` : ""}
    ${x.diaper ? diaperHtml(x) : ""}
    ${arrived ? `<div class="sp-arrived"><span>¿Ha llegado el pedido del ${esc(fmtDay(x.next))}${x.qty ? ` (${fmtQty(x.qty, x.unit)})` : ""}?</span>
      <span><button class="btn small" data-arrived="${esc(x.id)}">Sí, ha llegado</button> <button class="link small" data-notyet="${esc(x.id)}">Aún no</button></span></div>` : ""}
    <div class="sp-actions">
      ${x.pack && n.stock >= 1 ? `<button class="btn ghost small" data-open="${esc(x.id)}">Abrir paquete</button>` : ""}
      ${!x.sub ? `<button class="btn ghost small" data-received="${esc(x.id)}">Ha llegado más</button>` : ""}
      <button class="btn ghost small" data-adjust="${esc(x.id)}">Ajustar</button>
      ${n.status === "now" || n.status === "soon" ? `<button class="btn small" data-order="${esc(x.id)}">${link ? "Pedir" : "A la compra"}</button>` : ""}
      <button class="more" data-supply="${esc(x.id)}" aria-label="Editar ${esc(x.name)}">•••</button>
    </div>
  </li>`;
}

function render() {
  const root = $("view-recambios");
  if (!root || !ctx.hid) return;
  const urgent = list.filter((x) => now(x).status === "now");
  root.innerHTML = `
    <div class="view-head"><h1>Recambios</h1><button class="btn" id="sp-new">Añadir</button></div>
    ${urgent.length ? `<p class="sp-alert"><b>Hay que pedir:</b> ${urgent.map((x) => esc(x.name.toLowerCase())).join(", ")}.</p>` : ""}
    ${list.length ? `<ul class="supplies">${list.map(cardHtml).join("")}</ul>`
      : `<div class="empty"><strong>Sin recambios todavía</strong>Apunta lo que se va gastando (pañales, esponjas, bolsas, gasas, empapadores…) y te avisaré antes de que se acabe.
        <div style="margin-top:12px"><button class="btn" id="sp-starters">Empezar con pañales, esponjas, bolsas, gasas y empapadores</button></div></div>`}
    <p class="muted small-print">La app descuenta sola lo que se gasta cada día. Si no cuadra con lo que hay, pulsa «Ajustar».</p>`;
}

/* ---------- Eventos ---------- */
const find = (id) => list.find((x) => x.id === id);
// Guarda lo que hay ahora mismo (lo descontado se consolida) más el cambio indicado.
function save(x, change, msg) {
  const n = now(x);
  ctx.F.updateDoc(subDoc("supplies", x.id), { stock: n.stock, inUse: n.inUse, countedOn: ymd(), ...change(n) })
    .then(() => msg && toast(msg)).catch(failed);
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#view-recambios")) return;
  const q = (s) => e.target.closest(s);
  if (q("#sp-new")) return openSupply(null);
  if (q("#sp-starters")) {
    const b = ctx.F.writeBatch(ctx.fs);
    STARTERS.forEach((s, i) => b.set(ctx.F.doc(sub("supplies")), { ...s, order: i, stock: 0, inUse: 0, countedOn: ymd(), counted: false, sub: false, createdAt: Date.now(), by: ctx.uid }));
    try { await b.commit(); toast("Creados. Ahora pulsa «Ajustar» en cada uno para poner cuántos tenéis"); } catch (err) { failed(err); }
    return;
  }
  const id = (s) => q(s)?.dataset[Object.keys(q(s).dataset)[0]];
  if (q("[data-supply]")) return openSupply(find(id("[data-supply]")));
  if (q("[data-adjust]")) return openAdjust(find(id("[data-adjust]")));
  if (q("[data-open]")) {
    const x = find(id("[data-open]"));
    return save(x, (n) => ({ stock: Math.max(0, n.stock - x.pack), inUse: n.inUse + Math.min(x.pack, n.stock) }), `Abierto un paquete de ${x.pack}`);
  }
  if (q("[data-arrived]")) {
    const x = find(id("[data-arrived]"));
    return save(x, (n) => ({ counted: true, stock: n.stock + (Number(x.qty) || 0), next: addDays(x.next, (x.every || 4) * 7) }), `Sumados ${fmtQty(x.qty || 0, x.unit)} al armario`);
  }
  if (q("[data-notyet]")) {
    const x = find(id("[data-notyet]"));
    return ctx.F.updateDoc(subDoc("supplies", x.id), { next: addDays(ymd(), 1) }).then(() => toast("Te lo vuelvo a preguntar mañana")).catch(failed);
  }
  if (q("[data-received]")) return openAdjust(find(id("[data-received]")), true);
  if (q("[data-order]")) {
    const x = find(id("[data-order]")), link = safeUrl(x.link);
    if (link) { window.open(link, "_blank", "noopener"); return; }
    try {
      await ctx.F.addDoc(sub("items"), { name: x.name + (x.size ? ` talla ${x.size}` : ""), qty: x.pack ? "1 paquete" : "", store: x.store || "", aisle: "higiene", done: false, addedBy: ctx.uid, createdAt: Date.now(), doneAt: null });
      toast(`${x.name} añadido a la lista de la compra`);
    } catch (err) { failed(err); }
  }
});

function openSupply(x) {
  editingId = x?.id || null;
  $("sp-title").textContent = x ? `Editar ${x.name.toLowerCase()}` : "Nuevo recambio";
  $("sp-name").value = x?.name || ""; $("sp-unit").value = x?.unit || "";
  $("sp-daily").value = x?.daily != null ? String(x.daily).replace(".", ",") : ""; $("sp-pack").value = x?.pack || "";
  $("sp-diaper").checked = !!x?.diaper; $("sp-size").value = x?.size || "";
  $("sp-has-sub").checked = !!x?.sub; $("sp-every").value = x?.every || ""; $("sp-qty").value = x?.qty || "";
  $("sp-next").value = x?.next || ""; $("sp-store").value = x?.store || ""; $("sp-link").value = x?.link || "";
  $("sp-msg").textContent = ""; $("sp-delete").hidden = !x;
  syncForm();
  $("dlg-supply").showModal();
}
function syncForm() {
  $("sp-size-row").hidden = !$("sp-diaper").checked;
  document.querySelectorAll("#dlg-supply .sp-subf").forEach((el) => (el.hidden = !$("sp-has-sub").checked));
}
$("sp-diaper").addEventListener("change", syncForm);
$("sp-has-sub").addEventListener("change", syncForm);
$("sp-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const num = (id) => { const v = parseFloat(String($(id).value).replace(",", ".")); return isFinite(v) && v >= 0 ? v : null; };
  const hasSub = $("sp-has-sub").checked;
  if (hasSub && (!num("sp-every") || !$("sp-next").value)) { e.preventDefault(); $("sp-msg").textContent = "Para la suscripción, pon cada cuántas semanas llega y la fecha del próximo pedido."; return; }
  const data = {
    name: cap($("sp-name").value).slice(0, 50), unit: $("sp-unit").value.trim().slice(0, 20), daily: num("sp-daily") || 0, pack: Math.round(num("sp-pack") || 0),
    diaper: $("sp-diaper").checked, size: $("sp-diaper").checked ? $("sp-size").value : "",
    sub: hasSub, every: hasSub ? Math.round(num("sp-every")) : null, qty: hasSub ? Math.round(num("sp-qty") || 0) : null,
    next: hasSub ? $("sp-next").value : "", store: $("sp-store").value.trim().slice(0, 40), link: safeUrl($("sp-link").value.trim()) ? $("sp-link").value.trim() : "",
  };
  if (editingId) {
    const x = find(editingId), n = now(x);
    // Al cambiar el consumo, se consolida lo gastado hasta hoy con el consumo anterior.
    ctx.F.updateDoc(subDoc("supplies", editingId), { ...data, stock: n.stock, inUse: n.inUse, countedOn: ymd() }).catch(failed);
  } else ctx.F.addDoc(sub("supplies"), { ...data, stock: 0, inUse: 0, countedOn: ymd(), counted: false, order: list.length, createdAt: Date.now(), by: ctx.uid })
    .then(() => toast("Añadido. Pulsa «Ajustar» para poner cuántos hay")).catch(failed);
  editingId = null;
});
$("sp-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("supplies", editingId)).catch(failed);
  editingId = null;
  $("dlg-supply").close();
});

let adjustAdd = false;
function openAdjust(x, add = false) {
  adjustingId = x.id; adjustAdd = add;
  const n = now(x);
  $("aj-title").textContent = add ? `¿Cuántos ${x.unit || "han llegado"}?` : `¿Cuántos ${x.unit || x.name.toLowerCase()} hay?`;
  $("aj-stock").value = add ? "" : n.stock; $("aj-inuse").value = add ? 0 : n.inUse;
  $("aj-inuse").closest(".field").hidden = add;
  $("aj-stock").previousElementSibling.textContent = add ? "Han llegado (se suman al armario)" : "En el armario (sin abrir)";
  $("dlg-adjust").showModal();
}
$("aj-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const x = find(adjustingId); if (!x) return;
  const stock = Math.max(0, Math.round(Number($("aj-stock").value) || 0)), inUse = Math.max(0, Math.round(Number($("aj-inuse").value) || 0));
  if (adjustAdd) save(x, (n) => ({ stock: n.stock + stock, counted: true }), `Sumados ${fmtQty(stock, x.unit)} al armario`);
  else ctx.F.updateDoc(subDoc("supplies", x.id), { stock, inUse, countedOn: ymd(), counted: true }).then(() => toast("Guardado")).catch(failed);
});
