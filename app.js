import { firebaseConfig } from "./firebase-config.js";
import {
  FB, ctx, $, esc, cap, norm, initials, LS, toast, failed, houseRef, stores,
  storeOptions, newStore, shrink, askGemini, AISLES, AISLE_IDS, guessAisle,
  knownPeople, personColor, personKey, PERSON_COLORS,
} from "./core.js";
import * as gastos from "./gastos.js";
import * as viajes from "./viajes.js";
import * as calendario from "./calendario.js";
import * as citas from "./citas.js";
import * as cupones from "./cupones.js";
import * as tareas from "./tareas.js";
import * as pisosM from "./pisos.js";
import * as menuM from "./menu.js";
import "./viajes-correo.js";

const MODULES = [gastos, viajes, calendario, citas, cupones, tareas, pisosM, menuM];

/* ---------- Utilidades ---------- */
function show(screen) {
  for (const s of ["loading", "setup", "welcome", "app"]) $("screen-" + s).hidden = s !== screen;
}

/* ---------- Pestañas ---------- */
const VIEWS = { compra: null, tareas, calendario, citas, gastos, viajes, pisos: pisosM, menu: menuM };
const IN_MORE = ["gastos", "viajes", "pisos", "menu"];
function route() {
  if (!hid) return;
  let v = location.hash.slice(1);
  if (!(v in VIEWS)) v = LS.get("bretona.view") || "compra";
  if (!(v in VIEWS)) v = "compra";
  LS.set("bretona.view", v);
  for (const k of Object.keys(VIEWS)) $("view-" + k).hidden = k !== v;
  document.querySelectorAll(".tabbar [data-view]").forEach((a) => a.setAttribute("aria-current", (a.dataset.view === v || (a.dataset.view === "mas" && IN_MORE.includes(v))) ? "page" : "false"));
  document.querySelectorAll("#dlg-more [data-view]").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false"));
  if ($("dlg-more").open) $("dlg-more").close();
  VIEWS[v]?.onShow?.();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
$("tab-mas").addEventListener("click", () => $("dlg-more").showModal());
$("more-close").addEventListener("click", () => $("dlg-more").close());
document.querySelectorAll("#dlg-more [data-view]").forEach((l) => l.addEventListener("click", () => $("dlg-more").close()));
$("dlg-more").addEventListener("click", (e) => { if (e.target === $("dlg-more")) $("dlg-more").close(); });
// Avisos en la barra: tareas para hoy y pisos por votar.
function badges() {
  const setB = (id, n) => { $(id).textContent = n > 9 ? "9+" : n; $(id).hidden = !n; };
  const t = tareas.myDueCount(), p = pisosM.myPendingCount();
  setB("badge-tareas", t); setB("badge-pisos", p); setB("badge-mas", p);
}
ctx.onTasks = badges; ctx.onPisos = badges;
let noteTimer;
function note(msg, ms = 4000) {
  $("note").textContent = msg || "";
  clearTimeout(noteTimer);
  if (msg && ms) noteTimer = setTimeout(() => ($("note").textContent = ""), ms);
}
function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint32Array(8));
  const s = [...r].map((x) => A[x % A.length]).join("");
  return `BRT-${s.slice(0, 4)}-${s.slice(4)}`;
}
function normalizeCode(c) {
  const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.startsWith("BRT") ? s.slice(3) : s;
  return body.length === 8 ? `BRT-${body.slice(0, 4)}-${body.slice(4)}` : null;
}

/* ---------- Estado ---------- */
let F = {}; // funciones de Firebase cargadas
let app, auth, fs;
let uid = null, hid = null, house = null, items = [];
let filter = LS.get("bretona.filter") || "all";
let confirmClear = false, editingId = null;
let unsubHouse = null, unsubItems = null;

/* ---------- Arranque ---------- */
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PEGA_AQUI");
if (!configured) {
  show("setup");
} else {
  boot().catch((e) => {
    console.error(e);
    $("loading-msg").textContent = "No se ha podido abrir BRETONA. Comprueba la conexión y vuelve a abrir la app.";
  });
}

async function boot() {
  const [appM, authM, fsM] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js"),
  ]);
  F = { ...appM, ...authM, ...fsM };
  app = F.initializeApp(firebaseConfig);
  ctx.F = F; ctx.app = app;
  auth = F.getAuth(app);
  try {
    fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    fs = F.getFirestore(app);
  }
  ctx.fs = fs;

  // Código de invitación en el enlace (#unir-BRT-XXXX-XXXX)
  const m = location.hash.match(/^#unir-(.+)$/i);
  if (m) { $("w-code").value = normalizeCode(decodeURIComponent(m[1])) || ""; history.replaceState(null, "", location.pathname); }
  $("w-name").value = LS.get("bretona.name") || "";

  F.onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await F.signInAnonymously(auth); }
      catch (e) { console.error(e); $("loading-msg").textContent = "No se ha podido iniciar sesión. Revisa que el acceso anónimo esté activado en Firebase (paso 3 del LEEME)."; }
      return;
    }
    uid = user.uid; ctx.uid = uid;
    try {
      const snap = await F.getDoc(F.doc(fs, "users", uid));
      const saved = snap.exists() ? snap.data() : null;
      if (saved && saved.hid) openHouse(saved.hid);
      else show("welcome");
    } catch (e) {
      console.error(e);
      show("welcome");
    }
  });
}

/* ---------- Bienvenida ---------- */
function welcomeNote(msg) { $("w-note").textContent = msg || ""; }
function askName() {
  const name = cap($("w-name").value).slice(0, 30);
  if (!name) { welcomeNote("Escribe tu nombre para que los demás sepan quién añade cada cosa."); $("w-name").focus(); return null; }
  LS.set("bretona.name", name);
  return name;
}

$("w-create").addEventListener("click", async () => {
  const name = askName(); if (!name || !uid) return;
  welcomeNote("");
  $("w-create").disabled = true;
  try {
    const newHid = F.doc(F.collection(fs, "households")).id;
    const code = genCode();
    const b = F.writeBatch(fs);
    b.set(F.doc(fs, "households", newHid), {
      name: "BRETONA", members: [uid], memberNames: { [uid]: name },
      stores: ["Mercadona", "Lidl"], frequent: [], inviteCode: code, createdAt: Date.now(),
    });
    b.set(F.doc(fs, "invites", code), { hid: newHid });
    b.set(F.doc(fs, "users", uid), { hid: newHid, name });
    await b.commit();
    openHouse(newHid);
  } catch (e) {
    console.error(e);
    welcomeNote("No se ha podido crear la lista. Comprueba la conexión y que las reglas de Firestore estén publicadas (paso 4 del LEEME).");
  } finally {
    $("w-create").disabled = false;
  }
});

$("w-join").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = askName(); if (!name || !uid) return;
  const code = normalizeCode($("w-code").value);
  if (!code) { welcomeNote("El código tiene este formato: BRT-XXXX-XXXX."); return; }
  welcomeNote("");
  try {
    const inv = await F.getDoc(F.doc(fs, "invites", code));
    if (!inv.exists()) { welcomeNote("Ese código no existe. Revisa que esté bien escrito."); return; }
    const joinHid = inv.data().hid;
    await F.updateDoc(F.doc(fs, "households", joinHid), { members: F.arrayUnion(uid), ["memberNames." + uid]: name });
    await F.setDoc(F.doc(fs, "users", uid), { hid: joinHid, name });
    openHouse(joinHid);
  } catch (err) {
    console.error(err);
    welcomeNote("No se ha podido entrar en la lista. Comprueba la conexión y vuelve a intentarlo.");
  }
});

/* ---------- Lista de la familia ---------- */
function openHouse(id) {
  hid = id; ctx.hid = id;
  show("app");
  route();
  for (const m of MODULES) m.start?.();
  render();
  unsubHouse?.(); unsubItems?.();
  unsubHouse = F.onSnapshot(F.doc(fs, "households", hid), (s) => {
    if (!s.exists()) return;
    house = s.data(); ctx.house = house;
    if (!house.members?.includes(uid)) { leftHouse(); return; }
    render(); renderFamily();
    for (const m of MODULES) m.onHouse?.();
  }, (err) => {
    console.error(err);
    if (err.code === "permission-denied") leftHouse();
  });
  unsubItems = F.onSnapshot(F.collection(fs, "households", hid, "items"), (s) => {
    items = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => { console.error(err); note("Se ha perdido la conexión con la lista. Cierra y abre la app.", 0); });
}
function leftHouse() {
  unsubHouse?.(); unsubItems?.();
  for (const m of MODULES) m.stop?.();
  hid = null; house = null; items = [];
  ctx.hid = null; ctx.house = null;
  F.setDoc(F.doc(fs, "users", uid), { hid: null }, { merge: true }).catch(() => {});
  $("dlg-family").open && $("dlg-family").close();
  show("welcome");
}
const itemsRef = () => F.collection(fs, "households", hid, "items");
const itemRef = (id) => F.doc(fs, "households", hid, "items", id);
const myName = () => house?.memberNames?.[uid] || LS.get("bretona.name") || "";


async function addItem({ name, qty = "", store = "", aisle = null }) {
  name = cap(name).slice(0, 60); qty = String(qty || "").trim().slice(0, 12);
  if (!name || !hid) return false;
  const dup = items.find((i) => !i.done && norm(i.name) === norm(name) && (i.store || "") === (store || ""));
  if (dup) { note(`«${dup.name}» ya está en la lista`); flash(dup.id); return false; }
  // Con Firestore sin conexión la escritura queda pendiente y se envía al volver la red.
  F.addDoc(itemsRef(), {
    name, qty, store: store || "", aisle: AISLE_IDS.includes(aisle) ? aisle : guessAisle(name),
    done: false, addedBy: uid, createdAt: Date.now(), doneAt: null,
  }).catch(failed);
  return true;
}
function flash(id) {
  const el = document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1000); }
}

/* ---------- Pintar ---------- */
function visible(i) {
  if (filter === "all") return true;
  return (i.store || "") === filter || !i.store;
}

function render() {
  if (!hid) return;
  if (filter !== "all" && !stores().includes(filter) && house) { filter = "all"; LS.set("bretona.filter", "all"); }
  ctx.filter = filter;
  cupones.renderStrip();
  const pendingAll = items.filter((i) => !i.done);
  const pending = pendingAll.filter(visible);
  const done = items.filter((i) => i.done && visible(i));

  // Filtros por tienda
  const counts = {}; for (const i of pendingAll) if (i.store) counts[i.store] = (counts[i.store] || 0) + 1;
  const fl = [["all", "Todo", pendingAll.length], ...stores().map((s) => [s, s, counts[s] || 0])];
  $("filters").innerHTML = fl.map(([v, label, n]) =>
    `<button class="filter" role="tab" data-filter="${esc(v)}" aria-selected="${filter === v}">${esc(label)}${n ? `<span class="n">${n}</span>` : ""}</button>`).join("");

  // Selector de tienda al añadir: por defecto, la tienda filtrada
  const addSel = $("add-store");
  const keep = addSel.dataset.touched ? addSel.value : (filter === "all" ? "" : filter);
  addSel.innerHTML = storeOptions(keep === "__new" ? "" : keep);

  // Contador
  $("count").innerHTML = pending.length
    ? `Faltan <b>${pending.length}</b> ${pending.length === 1 ? "cosa" : "cosas"}${done.length ? ` · <b>${done.length}</b> en el carro` : ""}`
    : done.length ? "Todo en el carro" : "";

  // Lista
  const out = [];
  if (!items.length) {
    out.push(`<div class="empty"><strong>Nada que comprar</strong>Escribe arriba lo que falte en casa o haz una foto a tu lista de papel. Toda la familia lo verá al momento.</div>`);
  } else if (!pending.length && !done.length) {
    out.push(`<div class="empty"><strong>Nada para ${esc(filter)}</strong>No hay nada pendiente en esta tienda.</div>`);
  }
  for (const a of AISLES) {
    const list = pending.filter((i) => (i.aisle || "otros") === a.id).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
    if (!list.length) continue;
    out.push(`<section class="aisle" style="--c:${a.c}"><h2><span class="sw"></span>${a.name} <span class="n">${list.length}</span></h2><ul class="items">${list.map(itemHtml).join("")}</ul></section>`);
  }
  if (done.length) {
    out.push(`<section class="cart"><div class="cart-head"><h2>En el carro · ${done.length}</h2>${confirmClear
      ? `<span class="confirm">¿Quitar ${done.length} de la lista? <button class="btn danger-btn" data-act="clear-yes">Quitar</button><button class="link" data-act="clear-no">Cancelar</button></span>`
      : `<button class="link danger" data-act="clear">Quitar comprados</button>`}</div>
      <ul class="items">${done.sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0)).map(itemHtml).join("")}</ul></section>`);
  }
  $("list").innerHTML = out.join("");

  // Lo de siempre
  const onList = new Set(pendingAll.map((i) => norm(i.name)));
  const freq = (house?.frequent || []).filter((f) => !onList.has(norm(f))).slice(0, 18);
  $("chips").innerHTML = freq.map((f) => `<button class="chip" data-add="${esc(f)}">${esc(f)}</button>`).join("");
  $("chips-title").hidden = !freq.length;
}

function itemHtml(i) {
  const who = i.addedBy === uid ? "" : (house?.memberNames?.[i.addedBy] || "");
  const meta = [
    i.store ? `<span class="store-tag">${esc(i.store)}</span>` : "",
    who ? `<span>${esc(who)}</span>` : "",
  ].filter(Boolean).join("");
  return `<li class="item${i.done ? " done" : ""}" data-id="${esc(i.id)}">
    <button class="check" data-act="toggle" aria-label="${i.done ? "Desmarcar" : "Marcar como comprado"}: ${esc(i.name)}">${i.done ? '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}</button>
    <div class="label" data-act="toggle"><span class="name">${esc(i.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</div>
    ${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : ""}
    <button class="more" data-act="edit" aria-label="Editar ${esc(i.name)}">•••</button>
  </li>`;
}

/* ---------- Eventos de la lista ---------- */
$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const store = $("add-store").value === "__new" ? "" : $("add-store").value;
  if (await addItem({ name: $("add-name").value, qty: $("add-qty").value, store })) {
    $("add-name").value = ""; $("add-qty").value = "";
  }
  $("add-name").focus();
});
$("add-store").addEventListener("change", async (e) => {
  e.target.dataset.touched = "1";
  if (e.target.value === "__new") {
    const s = await newStore();
    render();
    $("add-store").value = s || "";
  }
});
$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]"); if (!b) return;
  filter = b.dataset.filter; LS.set("bretona.filter", filter);
  delete $("add-store").dataset.touched;
  confirmClear = false;
  render();
});
$("chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  addItem({ name: b.dataset.add, store: filter === "all" ? "" : filter });
});
$("list").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act;
  if (act === "clear") { confirmClear = true; render(); return; }
  if (act === "clear-no") { confirmClear = false; render(); return; }
  if (act === "clear-yes") {
    confirmClear = false;
    const done = items.filter((i) => i.done && visible(i));
    const seen = new Set();
    const freq = [...done.map((i) => i.name), ...(house?.frequent || [])]
      .filter((n) => { const k = norm(n); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    try {
      const b = F.writeBatch(fs);
      for (const i of done) b.delete(itemRef(i.id));
      b.update(houseRef(), { frequent: freq });
      await b.commit();
    } catch (err) { failed(err); }
    return;
  }
  const li = t.closest(".item"); if (!li) return;
  const it = items.find((i) => i.id === li.dataset.id); if (!it) return;
  if (act === "toggle") {
    // Al marcar como comprado se guarda en el historial (para Gastos); al desmarcar se quita.
    const now = Date.now();
    const b = F.writeBatch(fs);
    b.update(itemRef(it.id), { done: !it.done, doneAt: !it.done ? now : null });
    const pRef = F.doc(fs, "households", hid, "purchases", it.id);
    if (!it.done) b.set(pRef, { name: it.name, qty: it.qty || "", store: it.store || "", aisle: it.aisle || "otros", boughtAt: now, boughtBy: uid });
    else b.delete(pRef);
    b.commit().catch(failed);
  }
  if (act === "edit") openEdit(it);
});

/* ---------- Editar ---------- */
function openEdit(it) {
  editingId = it.id;
  $("e-name").value = it.name; $("e-qty").value = it.qty || "";
  $("e-store").innerHTML = storeOptions(it.store || "", { any: "Sin tienda" });
  $("e-aisle").innerHTML = AISLES.map((a) => `<option value="${a.id}"${a.id === (it.aisle || "otros") ? " selected" : ""}>${a.name}</option>`).join("");
  $("dlg-edit").showModal();
}
$("e-store").addEventListener("change", async (e) => {
  if (e.target.value === "__new") {
    const s = await newStore();
    e.target.innerHTML = storeOptions(s, { any: "Sin tienda" });
  }
});
$("dlg-edit").addEventListener("close", () => {
  if ($("dlg-edit").returnValue !== "save" || !editingId) { editingId = null; return; }
  const name = cap($("e-name").value).slice(0, 60);
  if (!name) return;
  const store = $("e-store").value === "__new" ? "" : $("e-store").value;
  F.updateDoc(itemRef(editingId), { name, qty: $("e-qty").value.trim().slice(0, 12), store, aisle: $("e-aisle").value }).catch(failed);
  editingId = null;
});
$("e-delete").addEventListener("click", () => {
  if (editingId) F.deleteDoc(itemRef(editingId)).catch(failed);
  editingId = null;
  $("dlg-edit").close("deleted");
});

/* ---------- Foto → productos ---------- */
let photoFound = [];
$("photo-btn").addEventListener("click", () => $("photo-input").click());
$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) readPhoto(file);
});
$("p-cancel").addEventListener("click", () => $("dlg-photo").close());


const PHOTO_PROMPT = `Eres el asistente de una lista de la compra familiar en España.
Mira la imagen: puede ser una lista escrita a mano, una nota del móvil, un ticket de compra, una receta, un folleto, una nevera o una despensa.
Extrae los productos que habría que comprar. Si es una receta, extrae sus ingredientes. Si es una nevera o despensa, solo lo que se vea casi acabado o claramente necesario.
Responde SOLO con JSON con esta forma exacta:
{"productos":[{"nombre":"Leche","cantidad":"2 l","seccion":"lacteos"}]}
Reglas:
- "nombre": en español, corto, con mayúscula inicial, sin marcas salvo que sean importantes.
- "cantidad": tal como aparezca ("2", "1 kg", "x6") o "" si no hay.
- "seccion": una de ${AISLE_IDS.join(", ")}.
- Si no ves ningún producto, devuelve {"productos":[]}.`;

async function readPhoto(file) {
  photoFound = [];
  $("p-list").innerHTML = "";
  $("p-add").disabled = true;
  $("p-add").textContent = "Añadir";
  $("p-status").innerHTML = `<span class="spinner"></span>Leyendo los productos…`;
  $("p-store").innerHTML = storeOptions(filter === "all" ? "" : filter, { any: "Sin tienda", addNew: false });
  $("p-img").removeAttribute("src");
  $("dlg-photo").showModal();

  let img;
  try { img = await shrink(file); $("p-img").src = img.preview; }
  catch { $("p-status").textContent = "No se puede abrir esta imagen. Prueba con otra foto (JPG o PNG)."; return; }

  let data;
  try { data = await askGemini(PHOTO_PROMPT, img.base64); }
  catch (e) { if ($("dlg-photo").open) $("p-status").textContent = e.message; return; }
  if (!$("dlg-photo").open) return; // cancelado mientras leía
  const found = !data ? [] : Array.isArray(data) ? data : (data.productos || data.items || []);
  const onList = new Set(items.filter((i) => !i.done).map((i) => norm(i.name)));
  const seen = new Set();
  photoFound = found
    .map((p) => ({ name: cap(p.nombre || p.name || "").slice(0, 60), qty: String(p.cantidad || p.qty || "").slice(0, 12), aisle: p.seccion || p.aisle }))
    .filter((p) => p.name && !seen.has(norm(p.name)) && seen.add(norm(p.name)))
    .map((p) => ({ ...p, originalName: p.name, already: onList.has(norm(p.name)), on: !onList.has(norm(p.name)) }));

  if (!photoFound.length) { $("p-status").textContent = "No he encontrado productos en esta foto."; return; }
  $("p-status").textContent = `He encontrado ${photoFound.length} ${photoFound.length === 1 ? "producto" : "productos"}. Revisa y corrige antes de añadir.`;
  $("p-list").innerHTML = photoFound.map((p, n) => `<li data-n="${n}" class="${p.on ? "" : "off"}">
    <input type="checkbox" id="p-on-${n}" ${p.on ? "checked" : ""} aria-label="Añadir ${esc(p.name)}">
    <input class="p-name" id="p-name-${n}" value="${esc(p.name)}" aria-label="Producto">
    <input class="p-qty" id="p-qty-${n}" value="${esc(p.qty)}" placeholder="Cant." aria-label="Cantidad">
  </li>${p.already ? `<li class="muted" style="font-size:12px;margin:-4px 0 0 30px">Ya está en la lista</li>` : ""}`).join("");
  updatePhotoBtn();
}
function updatePhotoBtn() {
  const n = photoFound.filter((p) => p.on).length;
  $("p-add").disabled = !n;
  $("p-add").textContent = n ? `Añadir ${n}` : "Añadir";
}
$("p-list").addEventListener("input", (e) => {
  const li = e.target.closest("li[data-n]"); if (!li) return;
  const p = photoFound[+li.dataset.n];
  if (e.target.type === "checkbox") { p.on = e.target.checked; li.classList.toggle("off", !p.on); updatePhotoBtn(); }
  else if (e.target.classList.contains("p-name")) p.name = e.target.value;
  else if (e.target.classList.contains("p-qty")) p.qty = e.target.value;
});
$("p-add").addEventListener("click", async () => {
  const store = $("p-store").value;
  const chosen = photoFound.filter((p) => p.on && cap(p.name));
  let added = 0;
  for (const p of chosen) {
    const sameName = norm(p.name) === norm(p.originalName);
    if (await addItem({ name: p.name, qty: p.qty, store, aisle: sameName ? p.aisle : null })) added++;
  }
  $("dlg-photo").close();
  note(added ? (added === 1 ? "Añadido 1 producto" : `Añadidos ${added} productos`) + " desde la foto" : "");
});

/* ---------- Familia y ajustes ---------- */
$("open-family").addEventListener("click", () => { renderFamily(); $("dlg-family").showModal(); });
$("f-close").addEventListener("click", () => $("dlg-family").close());
$("dlg-family").addEventListener("click", (e) => { if (e.target === $("dlg-family")) $("dlg-family").close(); });

function renderFamily() {
  if (!house) return;
  const names = house.memberNames || {};
  $("f-members").innerHTML = (house.members || []).map((m) => {
    const n = names[m] || "Alguien";
    return `<li><span class="avatar">${esc(initials(n))}</span><span>${esc(n)}${m === uid ? ' <span class="muted">(tú)</span>' : ""}</span></li>`;
  }).join("");
  $("f-code").textContent = house.inviteCode || "";
  $("f-share").hidden = !navigator.share;
  renderStores();
  renderPeople();
  if (document.activeElement !== $("f-name")) $("f-name").value = names[uid] || "";
}
function inviteText() {
  const link = location.origin + location.pathname + "#unir-" + house.inviteCode;
  return `Únete a nuestra lista de la compra en BRETONA.\n1. Abre ${link}\n2. Añádela a la pantalla de inicio.\n3. Escribe el código: ${house.inviteCode}`;
}
$("f-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(house.inviteCode); $("f-copy").textContent = "Copiado"; }
  catch { const r = document.createRange(); r.selectNodeContents($("f-code")); getSelection().removeAllRanges(); getSelection().addRange(r); }
  setTimeout(() => ($("f-copy").textContent = "Copiar"), 1800);
});
$("f-share").addEventListener("click", () => navigator.share?.({ title: "BRETONA", text: inviteText() }).catch(() => {}));
$("f-store-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = cap($("f-store-name").value).slice(0, 30);
  if (!s) return;
  if (!stores().some((x) => norm(x) === norm(s))) await F.updateDoc(houseRef(), { stores: F.arrayUnion(s) }).catch(failed);
  $("f-store-name").value = "";
});
/* ---------- Personas y colores ---------- */
function renderPeople() {
  const ppl = knownPeople();
  const memberKeys = new Set((house.members || []).map((m) => personKey(house.memberNames?.[m])));
  $("f-people").innerHTML = ppl.map((p) => {
    const c = personColor(p, ppl), k = personKey(p);
    return `<li class="pc pc-${c}">
      <span class="person-name">${esc(p)}</span>
      <span class="swatches" role="radiogroup" aria-label="Color de ${esc(p)}">${Array.from({ length: PERSON_COLORS }, (_, i) =>
        `<button class="sw pc-${i}" role="radio" aria-checked="${i === c}" aria-label="Color ${i + 1}" data-color="${i}" data-person="${esc(k)}"></button>`).join("")}</span>
      ${memberKeys.has(k) ? "" : `<button class="person-del" data-del-person="${esc(p)}" aria-label="Quitar a ${esc(p)}">×</button>`}
    </li>`;
  }).join("");
}
$("f-people").addEventListener("click", (e) => {
  const sw = e.target.closest("[data-color]");
  if (sw) { F.updateDoc(houseRef(), { ["personColors." + sw.dataset.person]: Number(sw.dataset.color) }).catch(failed); return; }
  const del = e.target.closest("[data-del-person]");
  if (del) F.updateDoc(houseRef(), { people: F.arrayRemove(del.dataset.delPerson), ["personColors." + personKey(del.dataset.delPerson)]: F.deleteField() }).catch(failed);
});
$("f-person-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = cap($("f-person-name").value).slice(0, 30);
  if (!n) return;
  if (!knownPeople().some((p) => personKey(p) === personKey(n))) {
    // Se fija su color al añadirla, para que no cambie el de nadie.
    const ppl = knownPeople([n]);
    F.updateDoc(houseRef(), { people: F.arrayUnion(n), ["personColors." + personKey(n)]: personColor(n, ppl) }).catch(failed);
  }
  $("f-person-name").value = "";
});

/* ---------- Tiendas: cambiar nombre, unir duplicadas y borrar ---------- */
let storeEdit = null; // { name, mode: "edit" | "delete" }
function renderStores() {
  if (storeEdit && !stores().includes(storeEdit.name)) storeEdit = null;
  if (storeEdit?.mode === "edit" && document.activeElement?.id === "f-store-rename") return; // no pisar lo que se escribe
  $("f-stores").innerHTML = stores().length
    ? stores().map((s) => {
      if (storeEdit?.name === s && storeEdit.mode === "edit") return `<li class="store-edit">
          <form class="row" data-rename="${esc(s)}"><input id="f-store-rename" value="${esc(s)}" maxlength="30" aria-label="Nuevo nombre de ${esc(s)}">
          <button class="btn" type="submit">Guardar</button><button class="link" type="button" data-store-cancel>Cancelar</button></form>
          <span class="muted small-print">Si escribes el nombre de otra tienda de la lista, se unen en una.</span></li>`;
      if (storeEdit?.name === s && storeEdit.mode === "delete") return `<li class="store-edit"><span class="confirm">¿Quitar ${esc(s)}? Lo pendiente de la lista quedará sin tienda.
          <button class="btn danger-btn" type="button" data-del-yes="${esc(s)}">Quitar</button><button class="link" type="button" data-store-cancel>Cancelar</button></span></li>`;
      return `<li><button class="store-name" data-edit-store="${esc(s)}" aria-label="Cambiar el nombre de ${esc(s)}">${esc(s)}</button><button data-del-store="${esc(s)}" aria-label="Quitar ${esc(s)}">×</button></li>`;
    }).join("")
    : `<li class="muted" style="background:none;padding:0">Aún no hay tiendas.</li>`;
  if (storeEdit?.mode === "edit") { const i = $("f-store-rename"); i.focus(); i.select(); }
}
$("f-stores").addEventListener("click", (e) => {
  const q = (sel) => e.target.closest(sel);
  if (q("[data-edit-store]")) { storeEdit = { name: q("[data-edit-store]").dataset.editStore, mode: "edit" }; renderStores(); return; }
  if (q("[data-del-store]")) { storeEdit = { name: q("[data-del-store]").dataset.delStore, mode: "delete" }; renderStores(); return; }
  if (q("[data-store-cancel]")) { storeEdit = null; renderStores(); return; }
  if (q("[data-del-yes]")) { const s = q("[data-del-yes]").dataset.delYes; storeEdit = null; renameStore(s, ""); }
});
$("f-stores").addEventListener("submit", (e) => {
  const f = e.target.closest("[data-rename]"); if (!f) return;
  e.preventDefault();
  const from = f.dataset.rename, to = cap($("f-store-rename").value).slice(0, 30);
  storeEdit = null;
  if (!to || to === from) { renderStores(); return; }
  renameStore(from, to);
});

// Cambia el nombre de una tienda (o la une con otra, o la quita si `to` está vacío)
// en la lista de tiendas y en todos los productos, tickets e historial que la usan.
async function renameStore(from, to) {
  const existing = to ? stores().find((x) => x !== from && norm(x) === norm(to)) : null;
  const target = to ? (existing || to) : "";
  const merging = !!existing;
  const next = !to || merging ? stores().filter((x) => x !== from) : stores().map((x) => (x === from ? target : x));
  try {
    const colls = to ? ["items", "tickets", "purchases"] : ["items"];
    for (const c of colls) {
      let qy = F.query(F.collection(fs, "households", hid, c), F.where("store", "==", from));
      const snap = await F.getDocs(qy);
      let docs = snap.docs;
      if (!to) docs = docs.filter((d) => !d.data().done); // al quitar: solo lo pendiente
      for (let i = 0; i < docs.length; i += 400) {
        const b = F.writeBatch(fs);
        for (const d of docs.slice(i, i + 400)) b.update(d.ref, { store: target });
        await b.commit();
      }
    }
    await F.updateDoc(houseRef(), { stores: next });
    if (filter === from) { filter = target || "all"; LS.set("bretona.filter", filter); }
    toast(!to ? `${from} quitada` : merging ? `${from} unida con ${target}` : `Ahora se llama ${target}`);
  } catch (err) { failed(err); }
}
$("f-name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const n = cap($("f-name").value).slice(0, 30); if (!n) return;
  LS.set("bretona.name", n);
  await F.updateDoc(houseRef(), { ["memberNames." + uid]: n }).catch(failed);
  F.setDoc(F.doc(fs, "users", uid), { name: n }, { merge: true }).catch(() => {});
  $("f-name").blur();
});
$("f-leave").addEventListener("click", () => { $("f-leave").hidden = true; $("f-leave-confirm").hidden = false; });
$("f-leave-no").addEventListener("click", () => { $("f-leave").hidden = false; $("f-leave-confirm").hidden = true; });
$("f-leave-yes").addEventListener("click", async () => {
  $("f-leave").hidden = false; $("f-leave-confirm").hidden = true;
  try {
    await F.updateDoc(houseRef(), { members: F.arrayRemove(uid), ["memberNames." + uid]: F.deleteField() });
  } catch (e) { failed(e); return; }
  leftHouse();
});
