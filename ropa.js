// Pestaña Banco de ropa: la ropa del bebé por tallas, con foto, para usarla toda y saber qué falta.
import { ctx, $, esc, cap, norm, toast, failed, sub, subDoc, houseRef, memberName, ymd, addDays, parseYmd, daysBetween, fmtDate, shrinkMany, askGemini, LS } from "./core.js";
import { growthApi } from "./crecimiento.js";

let items = [], unsub = null, editingId = null, photo = null;
// Lectura de Gemini en curso: { token, docId, touched } — se puede guardar sin esperarla.
let pendingAI = null, aiSeq = 0;

// Las fotos se convierten una sola vez en una dirección "blob:"; así el móvil no las descomprime
// de nuevo cada vez que se repinta la lista.
const blobCache = new Map();
function thumbUrl(x) {
  if (!x.thumb) return "";
  const key = x.id + ":" + x.thumb.length;
  let url = blobCache.get(key);
  if (!url) {
    try {
      const [head, b64] = x.thumb.split(",");
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg" }));
    } catch { url = x.thumb; }
    blobCache.set(key, url);
  }
  return url;
}
let showSize = LS.get("bretona.ropasize") || "";   // talla desplegada
let showGone = false;
let outfits = [], outfitBusy = false, outfitMsg = "", outfitFor = "";   // propuestas de conjuntos
let feedbackFor = -1, showOutfitPrefs = false;                            // opinión sobre una propuesta

// Tallas por centímetros de altura (lo que pone la etiqueta). Las estándar; también vale cualquier otro valor.
const STD_CM = [50, 56, 62, 68, 71, 74, 80, 86, 92, 98, 104, 110, 116];
// Prendas guardadas antes con talla por meses → centímetros.
const OLD_SIZE_CM = { "0-1m": 56, "1-3m": 62, "3-6m": 68, "6-9m": 74, "9-12m": 80, "12-18m": 86, "18-24m": 92, "2-3a": 98, "3-4a": 104 };
const cmOf = (x) => Number(x.cm) || OLD_SIZE_CM[x.size] || null;
// Equivalencia habitual de las etiquetas: cm → meses (68 cm = 6 meses, 74 cm = 9 meses…).
// Para tallas personalizadas se interpola entre las dos más cercanas.
const LABEL_AGE = [[50, 0], [56, 1], [62, 3], [68, 6], [71, 7.5], [74, 9], [80, 12], [86, 18], [92, 24], [98, 36], [104, 48], [110, 60], [116, 72]];
function labelAge(cm) {
  if (cm <= LABEL_AGE[0][0]) return 0;
  for (let i = 1; i < LABEL_AGE.length; i++) {
    const [c1, m1] = LABEL_AGE[i - 1], [c2, m2] = LABEL_AGE[i];
    if (cm <= c2) return m1 + ((cm - c1) / (c2 - c1)) * (m2 - m1);
  }
  return LABEL_AGE[LABEL_AGE.length - 1][1];
}
// Tipos de prenda y cuántas conviene tener por talla (orientativo). "season": cuándo hacen falta.
const TYPES = [
  { id: "body", label: "Bodies" },
  { id: "pijama", label: "Pijamas" },
  { id: "pelele", label: "Peleles" },
  { id: "conjunto", label: "Conjuntos (2 piezas)" },
  { id: "peto", label: "Petos" },
  { id: "pantalon", label: "Pantalones / leggings" },
  { id: "camiseta", label: "Camisetas" },
  { id: "jersey", label: "Jerséis / sudaderas" },
  { id: "abrigo", label: "Abrigos / chaquetas" },
  { id: "calcetines", label: "Calcetines (pares)" },
  { id: "gorro", label: "Gorros" },
  { id: "bandana", label: "Bandanas / baberos" },
  { id: "calzado", label: "Calzado / patucos" },
  { id: "bano", label: "Bañadores / ropa de verano" },
  { id: "otro", label: "Otro" },
];
// Estado de cada prenda. Solo las que "le valen" entran en los conjuntos.
const STATES = {
  ok: { label: "Le vale", badge: "" },
  big: { label: "Le queda grande", badge: "Grande" },
  small: { label: "Le queda pequeña", badge: "Pequeña" },
  damaged: { label: "Estropeada", badge: "Estropeada" },
  gone: { label: "Regalada o donada", badge: "Regalada" },
};
const SEASONS = { all: "Todo el año", frio: "Invierno", calor: "Verano", entre: "Entretiempo" };
const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1];

const childName = () => ctx.house?.child?.name || "el bebé";
const fmtMonths = (m) => (m < 0.75 ? "recién nacido" : m < 23.5 ? `${Math.round(m)} ${Math.round(m) === 1 ? "mes" : "meses"}` : `${Math.round(m / 12)} años`);
// Todas las tallas: las estándar más las que se hayan puesto a mano en alguna prenda.
const allCm = () => [...new Set([...STD_CM, ...items.map(cmOf).filter(Boolean)])].sort((a, b) => a - b);
// La talla de ahora: la más pequeña cuya etiqueta (en cm) aún es mayor que lo que mide hoy.
function currentCm() {
  const now = growthApi.lengthAt(ymd());
  return allCm().find((cm) => cm >= now) || allCm().slice(-1)[0];
}
const nextCm = (cm) => allCm().find((x) => x > cm);
// "68 cm ≈ 6 meses" y, para este bebé, hasta cuándo le valdrá según su curva de longitud.
function sizeInfo(cm) {
  const until = growthApi.dateForLength(cm);
  const prev = [...allCm()].reverse().find((x) => x < cm);
  const from = prev ? growthApi.dateForLength(prev) : null;
  return { std: fmtMonths(labelAge(cm)), from, until };
}
const ageAt = (date) => fmtMonths(daysBetween(growthApi.child().birth, date) / 30.4375);

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-cloth" class="sheet">
  <form method="dialog" id="cl-form">
    <h2 id="cl-title">Nueva prenda</h2>
    <div class="cl-photo-row">
      <img id="cl-img" alt="" hidden>
      <div class="cl-photo-btns">
        <button class="btn ghost" type="button" id="cl-photo-btn">Hacer o elegir foto</button>
        <p class="muted small-print" id="cl-status">Con la foto, Gemini propone el tipo, la talla y la temporada. Si se ve la etiqueta, mejor.</p>
      </div>
    </div>
    <input type="file" id="cl-photo" accept="image/*" hidden>
    <div class="row">
      <label class="field"><span>Tipo</span><select id="cl-type">${TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}</select></label>
      <label class="field"><span>Talla (cm)</span><input id="cl-size" type="number" inputmode="numeric" min="40" max="140" list="cl-size-list" placeholder="68"></label>
    </div>
    <div class="row">
      <label class="field"><span>Temporada</span><select id="cl-season">${Object.entries(SEASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="field" style="flex:0 0 96px"><span>Cuántas</span><input id="cl-qty" type="number" min="1" max="50" value="1"></label>
      <label class="field" style="flex:0 0 110px"><span>Veces puesta</span><input id="cl-worn" type="number" min="0" max="999" value="0"></label>
    </div>
    <p class="muted small-print" id="cl-size-hint"></p>
    <datalist id="cl-size-list">${STD_CM.map((c) => `<option value="${c}">`).join("")}</datalist>
    <label class="field"><span>Descripción</span><input id="cl-desc" maxlength="80" placeholder="Body de rayas azules, manga larga"></label>
    <label class="field"><span>Estado</span><select id="cl-state">${Object.entries(STATES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></label>
    <p class="note" id="cl-msg"></p>
    <div class="sheet-actions">
      <button class="link danger" type="button" id="cl-delete" hidden>Borrar</button>
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save" id="cl-save">Guardar</button>
    </div>
  </form>
</dialog>`);

export function start() {
  stop();
  unsub = ctx.F.onSnapshot(sub("clothes"), (s) => { items = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, (e) => console.error(e));
}
export function stop() { unsub?.(); unsub = null; items = []; }
export function onShow() { render(); }
export function onHouse() { render(); }

/* ---------- Pintar ---------- */
const count = (list) => list.reduce((n, x) => n + (Number(x.qty) || 1), 0);
// Aviso en la tarjeta cuando Gemini está leyendo la prenda, falló o no llegó a leerla.
const retrying = new Set();
function aiNote(x) {
  if (retrying.has(x.id)) return `<span class="ai-note"><span class="spinner"></span>Gemini está leyendo la prenda…</span>`;
  const stale = x.aiStatus === "pending" && Date.now() - (x.createdAt || 0) > 120000;
  if (x.aiStatus === "pending" && !stale) return `<span class="ai-note"><span class="spinner"></span>Gemini está leyendo la prenda…</span>`;
  if (x.aiStatus === "error" || stale || (!x.desc && x.thumb)) {
    return `<span class="ai-note err">${x.aiStatus === "error" ? esc(x.aiError || "Gemini no ha podido leerla.") : stale ? "Gemini no llegó a terminar." : "Sin datos de Gemini."}
      <button class="link small" data-reread="${esc(x.id)}">Leer con Gemini</button></span>`;
  }
  return "";
}
function itemHtml(x, highlight) {
  const t = typeOf(x.type), st = STATES[x.state] || STATES.ok;
  const worn = x.worn || 0;
  return `<li class="cloth-card st-${esc(x.state || "ok")}" data-id="${esc(x.id)}">
    <div class="cc-photo">
      ${x.thumb ? `<img src="${esc(thumbUrl(x))}" alt="${esc(x.desc || t.label)}" loading="lazy" decoding="async">` : `<span class="cc-empty" aria-hidden="true">${esc(t.label.slice(0, 1))}</span>`}
      ${st.badge ? `<span class="cc-badge">${esc(st.badge)}</span>` : highlight && !worn ? `<span class="cc-badge new">Sin estrenar</span>` : ""}
      ${x.qty > 1 ? `<span class="cc-qty">×${x.qty}</span>` : ""}
    </div>
    <div class="cc-body">
      <span class="cc-name">${esc(x.desc || t.label)}</span>
      <span class="muted small-print">${esc(t.label)}${cmOf(x) ? ` · ${cmOf(x)} cm` : ""}${highlight && x.state === "ok" && worn ? ` · ${worn} ${worn === 1 ? "vez" : "veces"}` : ""}</span>
      ${aiNote(x)}
      <div class="cc-actions">
        ${highlight && x.state === "ok" ? `<button class="btn ghost small worn-btn" data-worn="${esc(x.id)}" aria-label="Puesta hoy: ${esc(x.desc || t.label)}">✓ Hoy</button>` : ""}
        <select class="state-pick" data-state-of="${esc(x.id)}" aria-label="Estado de ${esc(x.desc || t.label)}">${Object.entries(STATES).map(([k, v]) => `<option value="${k}"${k === (x.state || "ok") ? " selected" : ""}>${v.label}</option>`).join("")}</select>
        <button class="more" data-cloth="${esc(x.id)}" aria-label="Editar prenda">•••</button>
      </div>
    </div>
  </li>`;
}

function render() {
  const root = $("view-ropa");
  if (!root || !ctx.hid) return;
  const cur = currentCm(), nxt = nextCm(cur), info = sizeInfo(cur);
  const weeksLeft = info.until ? Math.max(0, Math.round(daysBetween(ymd(), info.until) / 7)) : 0;
  const noSex = !growthApi.child().sex;
  const live = items.filter((x) => x.state !== "gone");
  const order = { ok: 0, big: 1, damaged: 2, small: 3 };
  const curItems = live.filter((x) => cmOf(x) === cur)
    .sort((a, b) => (order[a.state] ?? 0) - (order[b.state] ?? 0) || (a.worn || 0) - (b.worn || 0) || (a.lastWorn || "").localeCompare(b.lastWorn || ""));
  const outfitHtml = `<section class="panel outfit-panel">
      <div class="panel-head"><h2>¿Qué se pone hoy?</h2></div>
      <p class="small-print muted">Gemini combina la ropa de la talla de ahora, empezando por lo que menos se ha puesto.</p>
      <div class="outfit-btns">
        <button class="btn${outfitFor === "casa" ? "" : " ghost"}" data-outfit="casa" ${outfitBusy ? "disabled" : ""}>Para casa</button>
        <button class="btn${outfitFor === "salir" ? "" : " ghost"}" data-outfit="salir" ${outfitBusy ? "disabled" : ""}>Para salir</button>
      </div>
      ${outfitBusy ? `<p class="muted"><span class="spinner"></span>Combinando…</p>` : outfitMsg ? `<p class="small-print note">${esc(outfitMsg)}</p>` : ""}
      ${outfits.map((o, i) => `<div class="outfit">
        <div class="outfit-head"><b>${esc(o.name)}</b><button class="btn small" data-wear="${i}">Ponérselo</button></div>
        <div class="outfit-items">${o.items.map((x) => `<figure>${x.thumb ? `<img src="${esc(thumbUrl(x))}" alt="" decoding="async">` : `<span class="cl-thumb empty">${esc(typeOf(x.type).label.slice(0, 1))}</span>`}<figcaption>${esc(x.desc || typeOf(x.type).label)}</figcaption></figure>`).join("")}</div>
        ${o.why ? `<p class="small-print muted">${esc(o.why)}</p>` : ""}
        ${feedbackFor === i ? `<form class="outfit-fb" data-fb-form="${i}">
            <label class="field"><span>¿Por qué no os gusta? Gemini lo tendrá en cuenta</span><textarea id="of-reason" rows="2" maxlength="200" placeholder="Los colores no pegan, esa chaqueta no la usamos para casa, prefiero body de manga larga…"></textarea></label>
            <div class="row"><button class="btn small" type="submit">Enviar</button><button class="link small" type="button" data-fb-cancel>Cancelar</button></div>
          </form>`
          : o.rated === "si" ? `<p class="small-print ok-text">Os gusta: apuntado.</p>`
          : `<div class="outfit-rate"><button class="btn ghost small" data-like="${i}">👍 Nos gusta</button><button class="btn ghost small" data-dislike="${i}">👎 No nos gusta</button></div>`}
      </div>`).join("")}
      ${outfitPrefs().length ? `<button class="link small" id="of-prefs">${showOutfitPrefs ? "Ocultar" : "Ver"} lo que le habéis dicho (${outfitPrefs().length})</button>
        ${showOutfitPrefs ? `<ul class="star-prefs">${outfitPrefs().slice().reverse().map((x, k) => `<li><span>${esc(x.text)}</span><small class="muted">${esc(memberName(x.by) || "")}</small><button class="link small danger" data-del-of="${outfitPrefs().length - 1 - k}">Quitar</button></li>`).join("")}</ul>` : ""}` : ""}
    </section>`;
  const bySize = allCm().map((c) => ({ c, list: live.filter((x) => cmOf(x) === c) })).filter(({ c, list }) => list.length || c === cur || c === nxt);
  const noSize = live.filter((x) => !cmOf(x));
  const gone = items.filter((x) => x.state === "gone");

  root.innerHTML = `
    <div class="view-head"><h1>Banco de ropa</h1><button class="btn" id="cl-new">Añadir prenda</button></div>
    <section class="panel size-now">
      <div class="panel-head"><h2>Talla de ahora · <b>${cur} cm</b></h2><span class="muted small-print">≈ ${esc(info.std)} · ${weeksLeft ? `le valdrá ~${weeksLeft} semanas más` : "a punto de cambiar"}</span></div>
      <p class="small-print muted">${esc(childName())} mide ahora unos ${Math.round(growthApi.lengthAt(ymd()))} cm${info.until ? `; llegará a ${cur} cm hacia el ${esc(fmtDate(info.until))}` : ""}.${noSex ? " Completa los datos en Crecimiento para afinarlo." : ""}</p>
      ${curItems.some((x) => x.state === "ok" && !x.worn) ? `<p class="small-print muted">«Sin estrenar» = nunca marcada como puesta. Si es ropa que ya habíais usado, <button class="link small" id="cl-allused">márcala toda como ya usada</button> o pon las veces en •••.</p>` : ""}
      ${curItems.length ? `<p class="small-print muted">Primero lo que menos se ha puesto, para aprovecharlo todo antes de que se le quede pequeño.</p>
        <ul class="clothes grid">${curItems.map((x) => itemHtml(x, true)).join("")}</ul>` : `<p class="muted">No hay ropa de esta talla todavía. Añade las prendas con una foto.</p>`}
    </section>
    ${curItems.filter((x) => x.state === "ok").length >= 2 ? outfitHtml : ""}
    ${nxt ? `<section class="panel">
      <div class="panel-head"><h2>Siguiente talla · <b>${nxt} cm</b></h2><span class="muted small-print">≈ ${esc(sizeInfo(nxt).std)}${info.until ? ` · desde ~${esc(fmtDate(info.until))}` : ""}</span></div>
      <p class="small-print muted">${(() => { const n = count(live.filter((x) => cmOf(x) === nxt)); return n ? `Ya tenéis ${n} ${n === 1 ? "prenda preparada" : "prendas preparadas"}.` : "Aún no hay nada de esta talla."; })()}</p>
    </section>` : ""}
    <section class="panel plain">
      <h2>Todas las tallas</h2>
      ${bySize.map(({ c, list }) => { const si = sizeInfo(c); return `<div class="size-group">
        <button class="size-head" data-size="${c}" aria-expanded="${showSize === String(c)}"><span>${c} cm <small class="muted">≈ ${esc(si.std)}${si.until ? ` · a ${esc(childName())} hasta ~${esc(fmtDate(si.until))} (${esc(ageAt(si.until))})` : ""}</small></span><b>${count(list)}</b></button>
        ${showSize === String(c) ? (list.length ? `<ul class="clothes grid">${list.sort((a, b) => a.type.localeCompare(b.type)).map((x) => itemHtml(x, c === cur)).join("")}</ul>` : `<p class="muted small-print">Nada de esta talla.</p>`) : ""}
      </div>`; }).join("")}
      ${noSize.length ? `<div class="size-group"><button class="size-head" data-size="none" aria-expanded="${showSize === "none"}"><span>Sin talla</span><b>${count(noSize)}</b></button>
        ${showSize === "none" ? `<ul class="clothes grid">${noSize.map((x) => itemHtml(x, false)).join("")}</ul>` : ""}</div>` : ""}
    </section>
    ${gone.length ? `<button class="link small" id="cl-gone">${showGone ? "Ocultar" : "Ver"} regaladas o donadas (${count(gone)})</button>${showGone ? `<ul class="clothes grid">${gone.map((x) => itemHtml(x, false)).join("")}</ul>` : ""}` : ""}
    <p class="muted small-print">La talla es la altura en cm de la etiqueta. «≈ meses» es la equivalencia habitual de las etiquetas (68 cm = 6 meses); las fechas son las de ${esc(childName())} según su curva de longitud. Si le queda grande o pequeña antes, cámbialo en la tarjeta.</p>`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#view-ropa")) return;
  const q = (s) => e.target.closest(s);
  if (q("#cl-new")) return openCloth(null);
  if (q("#cl-gone")) { showGone = !showGone; render(); return; }
  if (q("[data-size]")) { const id = q("[data-size]").dataset.size; showSize = showSize === id ? "" : id; LS.set("bretona.ropasize", showSize); render(); return; }
  if (q("[data-cloth]")) return openCloth(items.find((x) => x.id === q("[data-cloth]").dataset.cloth));
  if (q(".cc-photo img")) return openCloth(items.find((x) => x.id === q(".cloth-card").dataset.id));
  if (q("[data-reread]")) {
    const x = items.find((i) => i.id === q("[data-reread]").dataset.reread);
    if (!x?.thumb || retrying.has(x.id)) return;
    retrying.add(x.id); render();
    try {
      const values = await readCloth(x.thumb.split(",")[1]);
      await ctx.F.updateDoc(subDoc("clothes", x.id), { ...toPatch(Object.entries(values)), aiStatus: ctx.F.deleteField(), aiError: ctx.F.deleteField() });
      toast("Datos de la prenda completados");
    } catch (err) {
      console.error(err);
      await ctx.F.updateDoc(subDoc("clothes", x.id), { aiStatus: "error", aiError: String(err.message || err).slice(0, 300) }).catch(() => {});
    }
    retrying.delete(x.id); render();
    return;
  }
  if (q("[data-worn]")) {
    const x = items.find((i) => i.id === q("[data-worn]").dataset.worn);
    ctx.F.updateDoc(subDoc("clothes", x.id), { worn: (x.worn || 0) + 1, lastWorn: ymd() }).catch(failed);
    return;
  }
  if (q("#cl-allused")) {
    const cur = currentCm();
    const todo = items.filter((x) => cmOf(x) === cur && x.state === "ok" && !x.worn);
    try {
      const b = ctx.F.writeBatch(ctx.fs);
      todo.forEach((x) => b.update(subDoc("clothes", x.id), { worn: 1 }));
      await b.commit();
      toast(`${todo.length} ${todo.length === 1 ? "prenda marcada" : "prendas marcadas"} como ya usadas`);
    } catch (err) { failed(err); }
    return;
  }
  if (q("[data-outfit]")) return suggestOutfits(q("[data-outfit]").dataset.outfit);
  if (q("[data-like]")) return rateOutfit(Number(q("[data-like]").dataset.like), true);
  if (q("[data-dislike]")) { feedbackFor = Number(q("[data-dislike]").dataset.dislike); render(); setTimeout(() => $("of-reason")?.focus(), 50); return; }
  if (q("[data-fb-cancel]")) { feedbackFor = -1; render(); return; }
  if (q("#of-prefs")) { showOutfitPrefs = !showOutfitPrefs; render(); return; }
  if (q("[data-del-of]")) {
    const list = outfitPrefs().slice(); list.splice(Number(q("[data-del-of]").dataset.delOf), 1);
    ctx.F.updateDoc(houseRef(), { outfitPrefs: list }).catch(failed); return;
  }
  if (q("[data-wear]")) {
    const o = outfits[Number(q("[data-wear]").dataset.wear)]; if (!o) return;
    try {
      const b = ctx.F.writeBatch(ctx.fs);
      o.items.forEach((x) => b.update(subDoc("clothes", x.id), { worn: (x.worn || 0) + 1, lastWorn: ymd() }));
      await b.commit();
      outfits = []; outfitMsg = ""; toast("¡Vestido! Apuntado como puesto hoy");
    } catch (err) { failed(err); }
  }
});

/* ---------- Combinar: conjuntos propuestos por Gemini ---------- */
const outfitPrefs = () => ctx.house?.outfitPrefs || [];
async function suggestOutfits(forWhat) {
  const cur = currentCm();
  // Para salir, nunca pijamas (son para dormir o estar en casa).
  const avail = items.filter((x) => cmOf(x) === cur && x.state === "ok" && !(forWhat === "salir" && x.type === "pijama"));
  if (avail.length < 2) { outfitMsg = forWhat === "salir" ? "Hace falta más ropa de calle de esta talla para combinar." : "Hace falta más ropa de esta talla para combinar."; render(); return; }
  outfitFor = forWhat; outfitBusy = true; outfitMsg = ""; feedbackFor = -1; render();
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(new Date());
  const prefs = outfitPrefs().slice(-25);
  const prompt = `Eres estilista de ropa de bebé. Con SOLO estas prendas de ${childName()} (talla ${cur} cm), propone 3 conjuntos para ${forWhat === "salir" ? "salir a la calle" : "estar en casa, cómodos"} hoy, en ${month} en Madrid.
Reglas:
- Usa la temperatura típica de ${month} en Madrid: abrigo y capas si hace frío, ropa fresca si hace calor.
${forWhat === "salir" ? "- Para salir NUNCA uses pijamas: son para dormir o estar en casa.\n" : "- Para estar en casa vale ropa cómoda, incluidos pijamas.\n"}- Que los colores combinen bien entre sí.
- Da prioridad a las prendas que menos se ha puesto (veces puesta) y no repitas una prenda en dos conjuntos si se puede evitar.
- Cada conjunto: 2 a 5 prendas que tengan sentido juntas (por ejemplo body + pantalón + jersey + calcetines; un pelele + calcetines; un peto + body). Una bandana o babero puede completar cualquiera.
${prefs.length ? `Lo que la familia ha dicho de propuestas anteriores (es lo MÁS importante, respétalo):\n${prefs.map((x) => "- " + x.text).join("\n")}\n` : ""}Prendas (id · tipo · descripción · temporada · veces puesta):
${avail.map((x) => `- ${x.id} · ${typeOf(x.type).label} · ${x.desc || "sin descripción"} · ${SEASONS[x.season] || ""} · ${x.worn || 0}`).join("\n")}
Responde SOLO con JSON con esta forma exacta:
{"conjuntos":[{"nombre":"Azul marinero","prendas":["id1","id2"],"por_que":"Una frase corta"}]}`;
  try {
    const d = await askGemini(prompt, null, { temperature: 0.7 });
    outfits = (d?.conjuntos || []).map((o) => ({
      name: cap(o.nombre || "Conjunto").slice(0, 40), why: String(o.por_que || "").slice(0, 160),
      items: (o.prendas || []).map((id) => avail.find((x) => x.id === id)).filter(Boolean),
    })).filter((o) => o.items.length >= 1).slice(0, 3);
    if (!outfits.length) outfitMsg = "Gemini no ha sabido combinar ahora. Prueba otra vez.";
  } catch (e) { outfitMsg = e.message || "No se ha podido combinar."; }
  outfitBusy = false; render();
}
// Guarda la opinión sobre una propuesta para que las siguientes se ajusten.
async function rateOutfit(i, liked, reason = "") {
  const o = outfits[i]; if (!o) return;
  const what = o.items.map((x) => x.desc || typeOf(x.type).label).join(" + ");
  const text = `${liked ? "Nos gusta" : "No nos gusta"} para ${outfitFor === "salir" ? "salir" : "casa"}: ${what}${reason ? ` — motivo: ${reason}` : ""}`;
  try {
    await ctx.F.updateDoc(houseRef(), { outfitPrefs: ctx.F.arrayUnion({ text: text.slice(0, 400), liked, at: Date.now(), by: ctx.uid }) });
    ctx.house = { ...ctx.house, outfitPrefs: [...outfitPrefs(), { text, liked }] };
    o.rated = liked ? "si" : "no";
    if (!liked) outfits.splice(i, 1);
    feedbackFor = -1;
    toast(liked ? "Apuntado: lo tendrá en cuenta" : "Apuntado. La próxima vez propondrá otra cosa");
    render();
  } catch (e) { failed(e); }
}

function openCloth(x) {
  if (pendingAI && !pendingAI.saved) pendingAI = null; // lo que quedara de una prenda cancelada
  editingId = x?.id || null; photo = null;
  $("cl-title").textContent = x ? "Editar prenda" : "Nueva prenda";
  $("cl-img").hidden = !x?.thumb; if (x?.thumb) $("cl-img").src = x.thumb;
  $("cl-type").value = x?.type || "body"; $("cl-size").value = x ? cmOf(x) || "" : currentCm();
  $("cl-season").value = x?.season || "all"; $("cl-qty").value = x?.qty || 1;
  $("cl-desc").value = x?.desc || ""; $("cl-state").value = x?.state || "ok"; $("cl-worn").value = x?.worn || 0;
  $("cl-msg").textContent = ""; $("cl-delete").hidden = !x; $("cl-save").disabled = false;
  $("cl-status").textContent = "Con la foto, Gemini propone el tipo, la talla y la temporada. Si se ve la etiqueta, mejor.";
  sizeHint();
  $("dlg-cloth").showModal();
}
$("cl-photo-btn").addEventListener("click", () => $("cl-photo").click());
// Al escribir la talla: "68 cm ≈ 6 meses · a Gael le valdrá hasta ~15 dic (5 meses)".
function sizeHint() {
  const cm = Number($("cl-size").value);
  if (!(cm >= 40 && cm <= 140)) { $("cl-size-hint").textContent = "Tallas habituales: " + STD_CM.slice(0, 9).join(", ") + " cm."; return; }
  const until = growthApi.dateForLength(cm);
  $("cl-size-hint").textContent = `${cm} cm ≈ ${fmtMonths(labelAge(cm))} (equivalencia habitual de las etiquetas)` +
    (until ? (until < ymd() ? ` · a ${childName()} ya le queda pequeña (la superó hacia el ${fmtDate(until)})` : ` · a ${childName()} le valdrá hasta ~${fmtDate(until)} (${ageAt(until)})`) : "");
}
$("cl-size").addEventListener("input", sizeHint);

const CLOTH_PROMPT = `Esta foto es una prenda de ropa de bebé o niño pequeño (puede verse la etiqueta con la talla).
Responde SOLO con JSON con esta forma exacta:
{"tipo":"body","talla_cm":68,"temporada":"all","descripcion":"Body de rayas azules, manga larga","cantidad":1}
- "tipo": uno de ${TYPES.map((t) => t.id).join(", ")}.
  Pistas: "pijama" = ropa de DORMIR (rizo, terciopelo o algodón suave, de una o dos piezas, normalmente con pies).
  "pelele" = prenda entera de UNA pieza para vestir o salir (punto, algodón con detalles), con o sin pies.
  "conjunto" = dos piezas a juego para vestir (jersey + pantalón o polaina). "peto" = pantalón con peto y tirantes.
  "bandana" = bandana o babero. Chaqueta de punto gruesa, rebeca con capucha, trenca o buzo → "abrigo".
  Jersey suelto → "jersey". Body con corchetes abajo → "body".
- "talla_cm": la talla en centímetros de la etiqueta (número). Si la etiqueta da meses, conviértelos así:
  0-1 m / 1 m → 56; 1-3 m / 3 m → 62; 3-6 m / 6 m → 68; 6-9 m / 9 m → 74; 9-12 m / 12 m → 80; 12-18 m / 18 m → 86; 18-24 m / 24 m → 92; 2-3 años → 98; 3-4 años → 104.
  Si no se ve la etiqueta, null (no lo adivines).
- "temporada": all, frio (abrigo, lana, manga larga gruesa), calor (manga corta, tirantes, bañador) o entre.
- "descripcion": corta, con color y detalle (manga larga/corta, estampado).
- "cantidad": cuántas prendas iguales se ven (normalmente 1).`;

// Pide a Gemini los datos de la prenda. Devuelve { "cl-type": …, … } o lanza un Error con el motivo.
async function readCloth(base64) {
  const d = await askGemini(CLOTH_PROMPT, base64);
  if (!d || typeof d !== "object") throw new Error("Gemini ha respondido algo que no entiendo.");
  const values = {};
  if (TYPES.some((t) => t.id === d.tipo)) values["cl-type"] = d.tipo;
  const cm = Math.round(Number(d.talla_cm));
  if (cm >= 40 && cm <= 140) values["cl-size"] = cm;
  if (SEASONS[d.temporada]) values["cl-season"] = d.temporada;
  if (d.descripcion) values["cl-desc"] = cap(d.descripcion).slice(0, 80);
  if (Number(d.cantidad) > 1) values["cl-qty"] = Math.min(50, Number(d.cantidad));
  if (!Object.keys(values).length) throw new Error("Gemini no ha reconocido la prenda en la foto.");
  return values;
}
const toPatch = (entries) => Object.fromEntries(entries.map(([id, v]) => [AI_FIELDS[id], id === "cl-qty" || id === "cl-size" ? Number(v) : v]));

const AI_FIELDS = { "cl-type": "type", "cl-size": "cm", "cl-season": "season", "cl-desc": "desc", "cl-qty": "qty" };
for (const id of Object.keys(AI_FIELDS)) $(id).addEventListener("input", () => pendingAI?.touched.add(id));

$("cl-photo").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const token = ++aiSeq;
  pendingAI = { token, docId: editingId, touched: new Set(), saved: false };
  $("cl-save").disabled = true;
  $("cl-status").innerHTML = '<span class="spinner"></span>Preparando la foto…';
  let big;
  try {
    // Una sola descompresión: 1024 px para que Gemini lea la etiqueta y 460 px para guardar (40-50 KB).
    const [forAI, small] = await shrinkMany(file, [[1024, 0.8], [460, 0.72]]);
    big = forAI; photo = small.preview;
    $("cl-img").src = photo; $("cl-img").hidden = false;
  } catch {
    $("cl-status").textContent = "No se puede abrir esta foto. Prueba con otra.";
    $("cl-save").disabled = false;
    return;
  }
  // Ya se puede guardar: Gemini completa los datos por detrás.
  $("cl-save").disabled = false;
  $("cl-status").innerHTML = '<span class="spinner"></span>Gemini está mirando la prenda. Puedes guardar ya: completará los datos al terminar.';
  let values = {}, err = null;
  try { values = await readCloth(big.base64); } catch (x) { err = x; console.error(x); }
  const job = pendingAI;
  if (!job || job.token !== token) return; // se eligió otra foto entretanto
  job.done = true; job.error = err ? err.message : "";
  const fresh = Object.entries(values).filter(([id]) => !job.touched.has(id));
  if (!job.saved && $("dlg-cloth").open) {
    for (const [id, v] of fresh) $(id).value = v;
    sizeHint();
    $("cl-status").textContent = err ? err.message + " Puedes rellenarlo a mano o guardarla y pulsar «Leer con Gemini» más tarde."
      : values["cl-size"] ? "Revisa los datos y pulsa Guardar." : "No se ve la talla en la foto: elígela tú.";
  } else if (job.saved) {
    // Ya estaba guardada: se completa con lo que no se cambió a mano (o se apunta el error en la tarjeta).
    const waitId = async () => { for (let i = 0; i < 40 && !job.docId; i++) await new Promise((r) => setTimeout(r, 250)); return job.docId; };
    const id = await waitId();
    if (id) {
      const patch = err ? { aiStatus: "error", aiError: err.message.slice(0, 300) } : { ...toPatch(fresh), aiStatus: ctx.F.deleteField(), aiError: ctx.F.deleteField() };
      ctx.F.updateDoc(subDoc("clothes", id), patch)
        .then(() => toast(err ? "Gemini no ha podido leer la prenda: mira la tarjeta" : "Gemini ha completado los datos de la prenda")).catch(() => {});
    }
  }
  if (job.saved || !$("dlg-cloth").open) pendingAI = null;
});
$("cl-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const data = {
    type: $("cl-type").value, cm: Number($("cl-size").value) >= 40 ? Math.round(Number($("cl-size").value)) : null, season: $("cl-season").value,
    qty: Math.min(50, Math.max(1, Number($("cl-qty").value) || 1)), desc: cap($("cl-desc").value).slice(0, 80), state: $("cl-state").value,
    worn: Math.max(0, Math.round(Number($("cl-worn").value) || 0)),
  };
  if (photo) data.thumb = photo;
  const job = pendingAI;
  if (job) {
    job.saved = true;
    if (!job.done) data.aiStatus = "pending";
    else if (job.error && !data.desc) Object.assign(data, { aiStatus: "error", aiError: job.error.slice(0, 300) });
  }
  if (editingId) ctx.F.updateDoc(subDoc("clothes", editingId), { ...data, size: ctx.F.deleteField() }).catch(failed);
  else ctx.F.addDoc(sub("clothes"), { ...data, by: ctx.uid, createdAt: Date.now() })
    .then((ref) => { if (job) job.docId = ref.id; toast(data.cm ? `Guardado en la talla ${data.cm} cm` : "Guardado"); }).catch(failed);
  editingId = null; photo = null;
});
$("cl-delete").addEventListener("click", () => {
  if (editingId) ctx.F.deleteDoc(subDoc("clothes", editingId)).catch(failed);
  editingId = null;
  $("dlg-cloth").close();
});

// Cambio rápido de estado desde la tarjeta (le vale, grande, pequeña, estropeada, regalada).
document.addEventListener("change", (e) => {
  const sel = e.target.closest?.("#view-ropa [data-state-of]"); if (!sel) return;
  const st = sel.value;
  ctx.F.updateDoc(subDoc("clothes", sel.dataset.stateOf), { state: st })
    .then(() => toast(st === "big" ? "Guardada para cuando le quede bien" : st === "damaged" ? "Marcada como estropeada: no saldrá en los conjuntos" : `Estado: ${STATES[st].label.toLowerCase()}`)).catch(failed);
});

document.addEventListener("submit", (e) => {
  const f = e.target.closest?.("[data-fb-form]"); if (!f) return;
  e.preventDefault();
  rateOutfit(Number(f.dataset.fbForm), false, ($("of-reason")?.value || "").trim().slice(0, 200));
});
