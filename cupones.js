// Cupones de descuento: dentro de la pestaña Compra.
import {
  ctx, $, esc, cap, norm, toast, failed, sub, subDoc, stores, houseRef,
  ymd, daysBetween, fmtDate, relDay, euro, parseEuro, storeOptions, newStore,
} from "./core.js";

let coupons = [], unsub = null;
let editingId = null, showOld = false;

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-coupons" class="sheet">
  <div class="sheet-head">
    <h2>Cupones</h2>
    <button class="icon-btn" id="cp-close" aria-label="Cerrar">×</button>
  </div>
  <div id="cp-list"></div>
  <button class="btn wide" id="cp-new">Añadir cupón</button>
</dialog>

<dialog id="dlg-coupon" class="sheet">
  <form method="dialog" id="cp-form">
    <h2 id="cp-title">Nuevo cupón</h2>
    <div class="row">
      <label class="field"><span>Descuento (€)</span><input id="cp-amount" inputmode="decimal" placeholder="3,00" required></label>
      <label class="field"><span>Caduca</span><input id="cp-exp" type="date" required></label>
    </div>
    <label class="field"><span>Tienda</span><select id="cp-store"></select></label>
    <label class="field"><span>Qué es</span><input id="cp-desc" maxlength="80" placeholder="3 € en compras de más de 30 €"></label>
    <label class="field"><span>Código (opcional)</span><input id="cp-code" maxlength="40" placeholder="Para enseñarlo en caja" autocapitalize="characters" spellcheck="false"></label>
    <p class="note" id="cp-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="cp-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("coupons"), (s) => {
    coupons = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStrip(); if ($("dlg-coupons").open) renderList();
    ctx.onCoupons?.();
  }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; coupons = []; }
export const getCoupons = () => coupons;

const active = () => coupons.filter((c) => !c.used && c.expires >= ymd());
const forFilter = (list) => (!ctx.filter || ctx.filter === "all") ? list : list.filter((c) => !c.store || c.store === ctx.filter);
const byExpiry = (a, b) => a.expires.localeCompare(b.expires);

// Franja de la pestaña Compra
export function renderStrip() {
  const el = $("coupons-strip");
  if (!el || !ctx.hid) return;
  const list = forFilter(active()).sort(byExpiry);
  const total = list.reduce((s, c) => s + (c.amount || 0), 0);
  const soon = list.filter((c) => daysBetween(ymd(), c.expires) <= 3);
  const where = ctx.filter && ctx.filter !== "all" ? ` para ${esc(ctx.filter)}` : "";
  el.innerHTML = list.length
    ? `<button class="coupon-strip${soon.length ? " warn" : ""}" id="cp-open">
        <span class="cs-ico" aria-hidden="true">${ticketIcon}</span>
        <span class="cs-text"><span><b>${list.length} ${list.length === 1 ? "cupón" : "cupones"}${where}</b> · ${euro(total)}</span>
          ${soon.length ? `<small>${esc(soon.length === 1 ? `Caduca ${relDay(soon[0].expires).toLowerCase()}: ${soon[0].desc || soon[0].store || euro(soon[0].amount)}` : `${soon.length} caducan en 3 días o menos`)}</small>` : ""}</span>
        <span class="cs-go" aria-hidden="true">›</span>
      </button>`
    : `<button class="link small" id="cp-open">+ Cupones de descuento</button>`;
}
const ticketIcon = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 14.5l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="14" r="1" fill="currentColor"/></svg>';

function couponHtml(c, state) {
  const days = daysBetween(ymd(), c.expires);
  const when = state === "used" ? `Usado${c.usedAt ? " el " + fmtDate(ymd(new Date(c.usedAt))) : ""}`
    : state === "expired" ? `Caducó el ${fmtDate(c.expires)}`
    : `Caduca ${days <= 6 ? relDay(c.expires).toLowerCase() : "el " + fmtDate(c.expires)}`;
  return `<li class="coupon ${state}${state === "active" && days <= 3 ? " soon" : ""}">
    <div class="cp-amount">${euro(c.amount)}</div>
    <div class="cp-body">
      <span class="cp-desc">${esc(c.desc || "Descuento")}</span>
      <span class="cp-meta">${c.store ? `<span class="store-tag">${esc(c.store)}</span>` : ""}<span>${esc(when)}</span></span>
      ${c.code ? `<span class="cp-code"><code>${esc(c.code)}</code> <button class="link small" data-cp-copy="${esc(c.code)}">Copiar</button></span>` : ""}
    </div>
    <div class="cp-actions">
      ${state === "active" ? `<button class="btn ghost" data-cp-use="${esc(c.id)}">Usado</button>` : state === "used" ? `<button class="link small" data-cp-unuse="${esc(c.id)}">Deshacer</button>` : ""}
      <button class="more" data-cp-edit="${esc(c.id)}" aria-label="Editar cupón">•••</button>
    </div>
  </li>`;
}

function renderList() {
  const today = ymd();
  const act = forFilter(active()).sort(byExpiry);
  const other = forFilter(coupons).filter((c) => !act.includes(c) && (c.used || c.expires < today))
    .sort((a, b) => (b.usedAt ? ymd(new Date(b.usedAt)) : b.expires).localeCompare(a.usedAt ? ymd(new Date(a.usedAt)) : a.expires));
  const filterNote = ctx.filter && ctx.filter !== "all" ? `<p class="muted small-print">Mostrando los de ${esc(ctx.filter)} y los que valen en cualquier tienda.</p>` : "";
  $("cp-list").innerHTML = `${filterNote}
    ${act.length ? `<ul class="coupons">${act.map((c) => couponHtml(c, "active")).join("")}</ul>`
      : `<p class="muted">No hay cupones vigentes. Apunta aquí los vales y descuentos para que no se os pasen.</p>`}
    ${other.length ? `<button class="link small" id="cp-old">${showOld ? "Ocultar" : "Ver"} usados y caducados (${other.length})</button>
      ${showOld ? `<ul class="coupons">${other.slice(0, 40).map((c) => couponHtml(c, c.used ? "used" : "expired")).join("")}</ul>` : ""}` : ""}`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("#cp-open")) { renderList(); $("dlg-coupons").showModal(); }
});
$("cp-close").addEventListener("click", () => $("dlg-coupons").close());
$("dlg-coupons").addEventListener("click", async (e) => {
  if (e.target === $("dlg-coupons")) { $("dlg-coupons").close(); return; }
  const q = (s) => e.target.closest(s);
  if (q("#cp-new")) return openCoupon(null);
  if (q("#cp-old")) { showOld = !showOld; renderList(); return; }
  if (q("[data-cp-edit]")) return openCoupon(coupons.find((c) => c.id === q("[data-cp-edit]").dataset.cpEdit));
  if (q("[data-cp-use]")) {
    const c = coupons.find((x) => x.id === q("[data-cp-use]").dataset.cpUse);
    ctx.F.updateDoc(subDoc("coupons", c.id), { used: true, usedAt: Date.now() }).then(() => toast(`Ahorrado ${euro(c.amount)}`)).catch(failed);
    return;
  }
  if (q("[data-cp-unuse]")) { ctx.F.updateDoc(subDoc("coupons", q("[data-cp-unuse]").dataset.cpUnuse), { used: false, usedAt: null }).catch(failed); return; }
  if (q("[data-cp-copy]")) {
    const v = q("[data-cp-copy]").dataset.cpCopy;
    try { await navigator.clipboard.writeText(v); toast("Código copiado"); } catch { toast(v, 6000); }
  }
});

function openCoupon(c) {
  editingId = c?.id || null;
  const def = c?.store ?? (ctx.filter && ctx.filter !== "all" ? ctx.filter : "");
  $("cp-title").textContent = c ? "Editar cupón" : "Nuevo cupón";
  $("cp-amount").value = c?.amount != null ? String(c.amount.toFixed(2)).replace(".", ",") : "";
  $("cp-exp").value = c?.expires || "";
  $("cp-store").innerHTML = storeOptions(def, { any: "Cualquier tienda" });
  $("cp-desc").value = c?.desc || ""; $("cp-code").value = c?.code || "";
  $("cp-msg").textContent = "";
  $("cp-delete").hidden = !c;
  $("dlg-coupon").showModal();
}
$("cp-store").addEventListener("change", async (e) => {
  if (e.target.value === "__new") { const s = await newStore(); e.target.innerHTML = storeOptions(s, { any: "Cualquier tienda" }); }
});
$("cp-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const amount = parseEuro($("cp-amount").value);
  if (amount == null || amount <= 0) { e.preventDefault(); $("cp-msg").textContent = "Escribe el descuento en euros, por ejemplo 3,50."; $("cp-amount").focus(); return; }
  if (!$("cp-exp").value) { e.preventDefault(); $("cp-msg").textContent = "Pon la fecha de caducidad."; return; }
  const store = $("cp-store").value === "__new" ? "" : $("cp-store").value;
  const data = { amount, expires: $("cp-exp").value, store, desc: cap($("cp-desc").value).slice(0, 80), code: $("cp-code").value.trim().slice(0, 40) };
  if (editingId) ctx.F.updateDoc(subDoc("coupons", editingId), data).catch(failed);
  else ctx.F.addDoc(sub("coupons"), { ...data, used: false, usedAt: null, addedBy: ctx.uid, createdAt: Date.now() })
    .then(() => toast(`Cupón de ${euro(amount)} guardado`)).catch(failed);
  editingId = null;
});
$("cp-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("coupons", editingId)).catch(failed);
  editingId = null;
  $("dlg-coupon").close();
});
