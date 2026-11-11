// Pestaña Menú: comidas de la semana propuestas por Gemini, con favoritas, descartadas
// y los ingredientes a un toque de la lista de la compra.
import {
  ctx, $, esc, cap, norm, toast, failed, sub, subDoc, houseRef,
  ymd, addDays, parseYmd, fmtDayLong, askGemini, guessAisle, AISLE_IDS, uidShort, LS,
} from "./core.js";

let menus = new Map(), recipes = [], unsubs = [];
let week = null;              // lunes de la semana que se ve (AAAA-MM-DD)
let busy = new Set();         // "week" o fechas que se están generando
let open = new Set();         // platos con la receta desplegada
let showLists = "";           // "", "fav", "no"
let shopList = [];            // ingredientes en la hoja de "añadir a la compra"

const DEFAULT_PREFS = { people: 2, days: 5, avoid: "Sin lactosa", notes: "" };
const prefs = () => ({ ...DEFAULT_PREFS, ...(ctx.house?.menuPrefs || {}) });
const monday = (d) => { const x = parseYmd(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return ymd(x); };
const recipeKey = (name) => norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "receta";
const favs = () => recipes.filter((r) => r.status === "fav");
const discarded = () => recipes.filter((r) => r.status === "no");
const isFav = (name) => favs().some((r) => r.id === recipeKey(name));

document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-menu-prefs" class="sheet">
  <form method="dialog" id="mp-form">
    <h2>Preferencias del menú</h2>
    <div class="row">
      <label class="field"><span>Personas</span><input id="mp-people" type="number" min="1" max="10" required></label>
      <label class="field"><span>Días</span><select id="mp-days"><option value="5">Lunes a viernes</option><option value="7">Lunes a domingo</option></select></label>
    </div>
    <label class="field"><span>Evitar</span><input id="mp-avoid" maxlength="200" placeholder="Sin lactosa, nada picante…"></label>
    <label class="field"><span>Otras indicaciones</span><textarea id="mp-notes" rows="2" maxlength="400" placeholder="Nos gusta la cocina mediterránea; poco tiempo entre semana…"></textarea></label>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="save">Guardar</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-menu-shop" class="sheet">
  <div class="sheet-head"><h2 id="ms-title">Añadir a la compra</h2><button class="icon-btn" id="ms-close" aria-label="Cerrar">×</button></div>
  <p class="muted small-print">Lo básico de despensa y lo que ya está en la lista aparece desmarcado.</p>
  <ul class="p-list" id="ms-list"></ul>
  <div class="sheet-actions">
    <button class="link small" type="button" id="ms-all">Marcar todo</button>
    <span class="spacer"></span>
    <button class="btn" id="ms-add" type="button">Añadir</button>
  </div>
</dialog>`);

export function start() {
  stop();
  week = LS.get("bretona.menuweek") || defaultWeek();
  if (week < monday(ymd())) week = defaultWeek();
  unsubs.push(ctx.F.onSnapshot(sub("menus"), (s) => {
    menus = new Map(s.docs.map((d) => [d.id, d.data()])); render();
  }, (e) => console.error(e)));
  unsubs.push(ctx.F.onSnapshot(sub("recipes"), (s) => {
    recipes = s.docs.map((d) => ({ id: d.id, ...d.data() })); render();
  }, (e) => console.error(e)));
}
export function stop() { unsubs.forEach((u) => u()); unsubs = []; menus = new Map(); recipes = []; }
export function onShow() { render(); }
export function onHouse() { render(); }
// Sábado y domingo se planifica ya la semana siguiente.
function defaultWeek() { const wd = new Date().getDay(); return wd === 0 || wd === 6 ? addDays(monday(ymd()), 7) : monday(ymd()); }

/* ---------- Gemini ---------- */
function recentNames(exceptWeek) {
  const names = [];
  for (const [w, m] of menus) if (w !== exceptWeek && w >= addDays(exceptWeek, -21) && w <= addDays(exceptWeek, 7)) for (const d of m.days || []) if (d.dish) names.push(d.dish.name);
  return names;
}
function promptFor(n, { keep = [], avoidNames = [] } = {}) {
  const p = prefs();
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(parseYmd(week));
  return `Eres un nutricionista y cocinero español. Propón ${n} ${n === 1 ? "plato" : "platos"} para la COMIDA de mediodía de ${p.people} ${p.people === 1 ? "persona" : "personas"}.
Requisitos:
- Platos equilibrados, variados entre sí y FÁCILES de preparar entre semana (normalmente 40 minutos o menos, con pocos pasos).
- Que cada plato sea una comida completa (proteína + verdura/hortaliza + hidrato), al estilo de la dieta mediterránea.
- Equilibrio semanal orientativo: legumbres 1-2 veces, pescado 1-2, carne (mejor blanca) 1-2, huevos 1, y verdura todos los días.
- Productos de temporada de ${month} en España.
${p.avoid ? `- EVITAR SIEMPRE: ${p.avoid}. Si una receta lleva normalmente lácteos u otro ingrediente a evitar, usa una alternativa adecuada (por ejemplo, versión sin lactosa) e indícalo en el ingrediente.` : ""}
${p.notes ? `- Indicaciones de la familia: ${p.notes}` : ""}
${keep.length ? `- Esta semana ya están estos platos, complementa con algo distinto: ${keep.join("; ")}.` : ""}
${avoidNames.length ? `- NO repitas ni propongas algo muy parecido a: ${avoidNames.slice(0, 60).join("; ")}.` : ""}
Responde SOLO con JSON con esta forma exacta:
{"platos":[{"nombre":"Lentejas estofadas con verduras","tiempo":35,"resumen":"Una frase apetecible","etiquetas":["legumbres"],"ingredientes":[{"nombre":"Lentejas pardinas","cantidad":"250 g","despensa":false},{"nombre":"Aceite de oliva","cantidad":"2 cucharadas","despensa":true}],"pasos":["Paso 1…","Paso 2…"]}]}
- "tiempo" en minutos (número). "etiquetas": 1-3 de legumbres, pescado, carne, huevos, verdura, pasta, arroz, vegetariano.
- Cantidades para ${p.people} ${p.people === 1 ? "persona" : "personas"}, en español ("200 g", "1 ud", "1 diente").
- "despensa": true para básicos que casi siempre hay en casa (sal, pimienta, aceite, vinagre, especias, ajo, harina, caldo en pastilla).
- Entre 4 y 8 pasos cortos y claros.`;
}
function toDish(x) {
  return {
    id: uidShort(), name: cap(x.nombre || x.name || "Plato").slice(0, 100), time: Number(x.tiempo) || null,
    summary: String(x.resumen || "").slice(0, 200), tags: (x.etiquetas || []).slice(0, 3).map((t) => String(t).toLowerCase().slice(0, 20)),
    ingredients: (x.ingredientes || []).slice(0, 25).map((i) => ({ name: cap(i.nombre || i.name || "").slice(0, 60), qty: String(i.cantidad || "").slice(0, 30), pantry: !!i.despensa })).filter((i) => i.name),
    steps: (x.pasos || []).slice(0, 12).map((t) => String(t).slice(0, 400)),
  };
}
async function ask(n, opts) {
  const data = await askGemini(promptFor(n, opts));
  const list = Array.isArray(data) ? data : data?.platos || [];
  if (!list.length) throw new Error("Gemini no ha propuesto platos. Prueba otra vez.");
  return list.slice(0, n).map(toDish);
}

async function generateWeek() {
  const p = prefs();
  const dates = Array.from({ length: Number(p.days) === 7 ? 7 : 5 }, (_, i) => addDays(week, i));
  busy.add("week"); render();
  try {
    // 1-2 favoritas que no hayan salido en las últimas semanas, en días al azar.
    const recent = new Set(recentNames(week).map(norm));
    const pool = favs().filter((r) => r.dish && !recent.has(norm(r.name))).sort(() => Math.random() - 0.5);
    const favCount = Math.min(pool.length, dates.length >= 5 ? 2 : 1);
    const chosen = pool.slice(0, favCount).map((r) => ({ ...r.dish, id: uidShort(), fromFav: true }));
    const fresh = await ask(dates.length - chosen.length, { keep: chosen.map((d) => d.name), avoidNames: [...recentNames(week), ...discarded().map((r) => r.name), ...favs().map((r) => r.name)] });
    const all = [...fresh];
    const favDays = new Set([...dates.keys()].sort(() => Math.random() - 0.5).slice(0, chosen.length));
    const days = dates.map((date, i) => ({ date, dish: favDays.has(i) ? chosen.pop() : all.shift() || null }));
    await ctx.F.setDoc(subDoc("menus", week), { week, days, createdAt: Date.now(), by: ctx.uid });
  } catch (e) { toast(e.message || "No se ha podido crear el menú.", 6000); }
  busy.delete("week"); render();
}

async function replaceDay(date, { discard = false } = {}) {
  const m = menus.get(week); if (!m) return;
  const day = m.days.find((d) => d.date === date);
  if (discard && day?.dish) {
    await ctx.F.setDoc(subDoc("recipes", recipeKey(day.dish.name)), { name: day.dish.name, status: "no", at: Date.now(), by: ctx.uid }).catch(failed);
  }
  busy.add(date); render();
  try {
    const others = m.days.filter((d) => d.date !== date && d.dish).map((d) => d.dish.name);
    const [dish] = await ask(1, { keep: others, avoidNames: [day?.dish?.name, ...recentNames(week), ...discarded().map((r) => r.name)].filter(Boolean) });
    const fresh = menus.get(week);
    const days = fresh.days.map((d) => (d.date === date ? { ...d, dish } : d));
    await ctx.F.updateDoc(subDoc("menus", week), { days });
    if (discard) toast("Descartada. No volverá a salir");
  } catch (e) { toast(e.message || "No se ha podido cambiar el plato.", 6000); }
  busy.delete(date); render();
}

function toggleFav(dish) {
  const key = recipeKey(dish.name);
  if (isFav(dish.name)) ctx.F.deleteDoc(subDoc("recipes", key)).then(() => toast("Quitada de favoritas")).catch(failed);
  else ctx.F.setDoc(subDoc("recipes", key), { name: dish.name, status: "fav", dish: { ...dish, fromFav: false }, at: Date.now(), by: ctx.uid })
    .then(() => toast("Guardada en favoritas: saldrá más a menudo")).catch(failed);
}

/* ---------- Añadir a la compra ---------- */
// Suma cantidades con la misma unidad ("200 g" + "300 g" = "500 g"); si no, las junta.
function addQty(a, b) {
  if (!a) return b; if (!b) return a;
  const parts = [...a.split(" + "), b];
  const sums = new Map(), rest = [];
  for (const q of parts) {
    const m = q.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (m) { const u = m[2].trim(); sums.set(u, (sums.get(u) || 0) + parseFloat(m[1].replace(",", "."))); }
    else rest.push(q.trim());
  }
  const fmt = (n) => (Math.round(n * 100) / 100).toString().replace(".", ",");
  return [...[...sums].map(([u, n]) => `${fmt(n)}${u ? " " + u : ""}`), ...new Set(rest)].join(" + ");
}
async function openShop(dishes, title) {
  const merged = new Map();
  for (const d of dishes) for (const i of d.ingredients || []) {
    const k = norm(i.name);
    const cur = merged.get(k);
    if (cur) cur.qty = addQty(cur.qty, i.qty);
    else merged.set(k, { name: i.name, qty: i.qty, pantry: i.pantry });
  }
  let pending = new Set();
  try {
    const snap = await ctx.F.getDocs(sub("items"));
    pending = new Set(snap.docs.map((d) => d.data()).filter((x) => !x.done).map((x) => norm(x.name)));
  } catch {}
  shopList = [...merged.values()].map((i) => ({ ...i, already: pending.has(norm(i.name)), on: !i.pantry && !pending.has(norm(i.name)) }));
  $("ms-title").textContent = title;
  $("ms-list").innerHTML = shopList.map((i, n) => `<li data-n="${n}" class="${i.on ? "" : "off"}">
    <input type="checkbox" id="ms-on-${n}" ${i.on ? "checked" : ""} aria-label="Añadir ${esc(i.name)}">
    <label for="ms-on-${n}" class="ms-name">${esc(i.name)}${i.already ? ' <small class="muted">ya en la lista</small>' : i.pantry ? ' <small class="muted">despensa</small>' : ""}</label>
    <span class="ms-qty">${esc(i.qty)}</span>
  </li>`).join("");
  updateShopBtn();
  $("dlg-menu-shop").showModal();
}
function updateShopBtn() {
  const n = shopList.filter((i) => i.on).length;
  $("ms-add").disabled = !n;
  $("ms-add").textContent = n ? `Añadir ${n}` : "Añadir";
}
$("ms-list").addEventListener("change", (e) => {
  const li = e.target.closest("li[data-n]"); if (!li) return;
  shopList[+li.dataset.n].on = e.target.checked; li.classList.toggle("off", !e.target.checked); updateShopBtn();
});
$("ms-all").addEventListener("click", () => {
  shopList.forEach((i) => (i.on = true));
  $("ms-list").querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = true));
  $("ms-list").querySelectorAll("li").forEach((l) => l.classList.remove("off"));
  updateShopBtn();
});
$("ms-close").addEventListener("click", () => $("dlg-menu-shop").close());
$("ms-add").addEventListener("click", async () => {
  const chosen = shopList.filter((i) => i.on);
  try {
    const b = ctx.F.writeBatch(ctx.fs);
    const now = Date.now();
    chosen.forEach((i, n) => b.set(ctx.F.doc(sub("items")), {
      name: i.name, qty: i.qty.slice(0, 12), store: "", aisle: guessAisle(i.name), done: false, addedBy: ctx.uid, createdAt: now + n, doneAt: null, fromMenu: true,
    }));
    await b.commit();
    toast(`${chosen.length} ${chosen.length === 1 ? "ingrediente añadido" : "ingredientes añadidos"} a la compra`);
  } catch (e) { failed(e); }
  $("dlg-menu-shop").close();
});

/* ---------- Pintar ---------- */
const star = (on) => `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

function dayHtml(d) {
  const dish = d.dish, loading = busy.has(d.date) || busy.has("week");
  const today = d.date === ymd();
  if (!dish) return `<li class="dish empty-dish"><span class="dish-day">${esc(fmtDayLong(d.date))}</span><button class="link small" data-replace="${d.date}">Proponer plato</button></li>`;
  const fav = isFav(dish.name), isOpen = open.has(dish.id);
  return `<li class="dish${today ? " today" : ""}${loading ? " loading" : ""}">
    <div class="dish-head">
      <span class="dish-day">${today ? "Hoy · " : ""}${esc(fmtDayLong(d.date))}</span>
      <button class="fav-btn${fav ? " on" : ""}" data-fav="${d.date}" aria-pressed="${fav}" aria-label="${fav ? "Quitar de favoritas" : "Guardar en favoritas"}">${star(fav)}</button>
    </div>
    ${loading && busy.has(d.date) ? `<p class="muted"><span class="spinner"></span>Buscando otro plato…</p>` : `
    <h3 class="dish-name">${esc(dish.name)}</h3>
    <p class="dish-sum">${esc(dish.summary)}</p>
    <div class="dish-tags">${dish.time ? `<span class="tag">${dish.time} min</span>` : ""}${(dish.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}${dish.fromFav ? `<span class="tag fav">favorita</span>` : ""}</div>
    ${isOpen ? `<div class="recipe">
      <h4>Ingredientes · ${prefs().people} ${prefs().people === 1 ? "persona" : "personas"}</h4>
      <ul class="ingr">${dish.ingredients.map((i) => `<li><span>${esc(i.name)}</span><span class="muted">${esc(i.qty)}</span></li>`).join("")}</ul>
      <h4>Preparación</h4>
      <ol class="steps">${dish.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>` : ""}
    <div class="dish-actions">
      <button class="link small" data-open="${dish.id}">${isOpen ? "Ocultar receta" : "Ver receta"}</button>
      <button class="link small" data-shop-day="${d.date}">A la compra</button>
      <button class="link small" data-replace="${d.date}">Cambiar</button>
      <button class="link small danger" data-discard="${d.date}">No me gusta</button>
    </div>`}
  </li>`;
}

function render() {
  const root = $("view-menu");
  if (!root || !ctx.hid || !week) return;
  const m = menus.get(week);
  const thisWeek = monday(ymd());
  const label = week === thisWeek ? "Esta semana" : week === addDays(thisWeek, 7) ? "La semana que viene" : `Semana del ${fmtDayLong(week)}`;
  const p = prefs();
  const lists = showLists === "fav" ? favs() : showLists === "no" ? discarded() : [];
  root.innerHTML = `
    <div class="view-head"><h1>Menú</h1><button class="link small" id="mn-prefs">Preferencias</button></div>
    <div class="week-nav">
      <button class="icon-btn" id="mn-prev" aria-label="Semana anterior" ${week <= thisWeek ? "disabled" : ""}>‹</button>
      <div><b>${esc(label)}</b><span class="muted small-print">Comidas · ${p.people} ${p.people === 1 ? "persona" : "personas"}${p.avoid ? " · " + esc(p.avoid.toLowerCase()) : ""}</span></div>
      <button class="icon-btn" id="mn-next" aria-label="Semana siguiente" ${week >= addDays(thisWeek, 7) ? "disabled" : ""}>›</button>
    </div>
    ${!m ? `<div class="empty"><strong>${busy.has("week") ? '<span class="spinner"></span>Preparando el menú…' : "Sin menú para esta semana"}</strong>
        ${busy.has("week") ? "Tarda unos segundos." : `Platos equilibrados, variados y fáciles. ${favs().length ? `Incluirá alguna de vuestras ${favs().length} favoritas.` : "Marca con la estrella los que os gusten y saldrán más a menudo."}`}
        ${busy.has("week") ? "" : `<div style="margin-top:12px"><button class="btn" id="mn-gen">Proponer menú</button></div>`}</div>`
      : `<ul class="dishes">${m.days.map(dayHtml).join("")}</ul>
        <div class="menu-foot">
          <button class="btn" id="mn-shop-week">Añadir ingredientes de la semana</button>
          <button class="btn ghost" id="mn-regen" ${busy.has("week") ? "disabled" : ""}>Proponer otro menú</button>
        </div>`}
    <div class="menu-lists">
      <button class="link small" data-lists="fav">${showLists === "fav" ? "Ocultar" : "Ver"} favoritas (${favs().length})</button>
      <button class="link small" data-lists="no">${showLists === "no" ? "Ocultar" : "Ver"} descartadas (${discarded().length})</button>
    </div>
    ${showLists ? `<ul class="recipe-list">${lists.length ? lists.map((r) => `<li><span>${esc(r.name)}</span><button class="link small" data-unlist="${esc(r.id)}">${showLists === "fav" ? "Quitar" : "Recuperar"}</button></li>`).join("") : `<li class="muted">${showLists === "fav" ? "Aún no hay favoritas." : "No habéis descartado ninguna."}</li>`}</ul>` : ""}`;
}

/* ---------- Eventos ---------- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#view-menu")) return;
  const q = (s) => e.target.closest(s);
  const m = menus.get(week);
  const dayOf = (date) => m?.days.find((d) => d.date === date);
  if (q("#mn-prev")) { week = addDays(week, -7); LS.set("bretona.menuweek", week); render(); return; }
  if (q("#mn-next")) { week = addDays(week, 7); LS.set("bretona.menuweek", week); render(); return; }
  if (q("#mn-gen") || q("#mn-regen")) { if (!busy.has("week")) generateWeek(); return; }
  if (q("#mn-prefs")) return openPrefs();
  if (q("#mn-shop-week")) return openShop(m.days.map((d) => d.dish).filter(Boolean), "Ingredientes de la semana");
  if (q("[data-open]")) { const id = q("[data-open]").dataset.open; open.has(id) ? open.delete(id) : open.add(id); render(); return; }
  if (q("[data-fav]")) { const d = dayOf(q("[data-fav]").dataset.fav); if (d?.dish) toggleFav(d.dish); return; }
  if (q("[data-shop-day]")) { const d = dayOf(q("[data-shop-day]").dataset.shopDay); if (d?.dish) openShop([d.dish], d.dish.name); return; }
  if (q("[data-replace]")) { const date = q("[data-replace]").dataset.replace; if (!busy.has(date)) replaceDay(date); return; }
  if (q("[data-discard]")) { const date = q("[data-discard]").dataset.discard; if (!busy.has(date)) replaceDay(date, { discard: true }); return; }
  if (q("[data-lists]")) { const v = q("[data-lists]").dataset.lists; showLists = showLists === v ? "" : v; render(); return; }
  if (q("[data-unlist]")) ctx.F.deleteDoc(subDoc("recipes", q("[data-unlist]").dataset.unlist)).catch(failed);
});

function openPrefs() {
  const p = prefs();
  $("mp-people").value = p.people; $("mp-days").value = String(p.days); $("mp-avoid").value = p.avoid; $("mp-notes").value = p.notes;
  $("dlg-menu-prefs").showModal();
}
$("mp-form").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  ctx.F.updateDoc(houseRef(), { menuPrefs: {
    people: Math.min(10, Math.max(1, Number($("mp-people").value) || 2)), days: Number($("mp-days").value) === 7 ? 7 : 5,
    avoid: $("mp-avoid").value.trim().slice(0, 200), notes: $("mp-notes").value.trim().slice(0, 400),
  } }).then(() => toast("Preferencias guardadas. Se aplican al próximo menú")).catch(failed);
});
