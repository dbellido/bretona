import { firebaseConfig, geminiModels } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/12.19.0/";

/* ---------- Secciones del súper y clasificación automática ---------- */
const AISLES = [
  { id: "fruta", name: "Fruta y verdura", c: "#3f9a4f", k: ["manzana","platano","naranja","mandarina","limon","fresa","uva","pera","melocoton","tomate","lechuga","cebolla","ajo","patata","zanahoria","pimiento","calabacin","berenjena","pepino","aguacate","espinaca","brocoli","coliflor","fruta","verdura","melon","sandia","kiwi","champinon","seta","perejil","cilantro","puerro","judia verde","alcachofa","calabaza","mango","pina","cereza"] },
  { id: "carne", name: "Carne y pescado", c: "#c2553a", k: ["pollo","carne","ternera","cerdo","cordero","jamon","pavo","chorizo","salchicha","hamburguesa","pescado","merluza","salmon","gamba","langostino","bacalao","lomo","filete","embutido","fuet","salchichon","mortadela","sepia","calamar","mejillon","dorada","lubina","costilla","picada"] },
  { id: "lacteos", name: "Lácteos y huevos", c: "#d9a520", k: ["leche","yogur","queso","mantequilla","nata","huevo","kefir","batido","cuajada","natillas","flan"] },
  { id: "panaderia", name: "Pan y desayuno", c: "#a8743a", k: ["pan","tostada","galleta","cereal","cafe","te ","infusion","cacao","magdalena","bolleria","mermelada","colacao","croissant","bizcocho","miel"] },
  { id: "despensa", name: "Despensa", c: "#6a7b3a", k: ["arroz","pasta","macarron","espagueti","fideo","harina","azucar","sal","aceite","vinagre","lenteja","garbanzo","alubia","atun","sardina","conserva","tomate frito","especia","pimenton","oregano","legumbre","caldo","sopa","mayonesa","ketchup","mostaza","aceituna","patatas fritas","frutos secos","chocolate","levadura"] },
  { id: "bebidas", name: "Bebidas", c: "#2f7fb5", k: ["agua","zumo","refresco","cerveza","vino","coca","bebida","gaseosa","tonica","cava","sidra","leche de avena","bebida vegetal"] },
  { id: "congelados", name: "Congelados", c: "#5a9fb8", k: ["congelad","helado","pizza","croqueta","guisante","empanadilla","hielo","varitas"] },
  { id: "limpieza", name: "Limpieza y hogar", c: "#7d5fb2", k: ["lejia","detergente","suavizante","friegasuelos","lavavajillas","bolsa de basura","bolsas","estropajo","papel de cocina","servilleta","esponja","limpiador","ambientador","papel de aluminio","film","bombilla","pila","fregona","bayeta"] },
  { id: "higiene", name: "Higiene", c: "#b5487f", k: ["champu","gel","pasta de dientes","dentifrico","cepillo","desodorante","papel higienico","compresa","tampon","panal","toallita","crema","jabon","colonia","maquinilla","cuchilla","algodon","tirita"] },
  { id: "otros", name: "Otros", c: "#7c8a83", k: [] },
];
const AISLE_IDS = AISLES.map((a) => a.id);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n").trim();
function guessAisle(name) {
  const n = " " + norm(name) + " ";
  let best = null, len = 0;
  for (const a of AISLES) for (const k of a.k) if (n.includes(k) && k.length > len) { best = a.id; len = k.length; }
  return best || "otros";
}

/* ---------- Utilidades ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => { s = String(s || "").trim().replace(/\s+/g, " "); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function show(screen) {
  for (const s of ["loading", "setup", "welcome", "app"]) $("screen-" + s).hidden = s !== screen;
}
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
  auth = F.getAuth(app);
  try {
    fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    fs = F.getFirestore(app);
  }

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
    uid = user.uid;
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
  hid = id;
  show("app");
  render();
  unsubHouse?.(); unsubItems?.();
  unsubHouse = F.onSnapshot(F.doc(fs, "households", hid), (s) => {
    if (!s.exists()) return;
    house = s.data();
    if (!house.members?.includes(uid)) { leftHouse(); return; }
    render(); renderFamily();
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
  hid = null; house = null; items = [];
  F.setDoc(F.doc(fs, "users", uid), { hid: null }, { merge: true }).catch(() => {});
  $("dlg-family").open && $("dlg-family").close();
  show("welcome");
}
const itemsRef = () => F.collection(fs, "households", hid, "items");
const itemRef = (id) => F.doc(fs, "households", hid, "items", id);
const houseRef = () => F.doc(fs, "households", hid);
const myName = () => house?.memberNames?.[uid] || LS.get("bretona.name") || "";
const stores = () => (house?.stores || []);

function failed(e) {
  console.error(e);
  note(e?.code === "permission-denied" ? "Ya no tienes acceso a esta lista." : "No se ha guardado. Revisa la conexión.");
}

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
function storeOptions(selected, { any = "Cualquier tienda", addNew = true } = {}) {
  const list = [...stores()];
  if (selected && !list.includes(selected)) list.push(selected);
  return `<option value="">${esc(any)}</option>` +
    list.map((s) => `<option value="${esc(s)}"${s === selected ? " selected" : ""}>${esc(s)}</option>`).join("") +
    (addNew ? `<option value="__new">+ Nueva tienda…</option>` : "");
}
function visible(i) {
  if (filter === "all") return true;
  return (i.store || "") === filter || !i.store;
}

function render() {
  if (!hid) return;
  if (filter !== "all" && !stores().includes(filter) && house) { filter = "all"; LS.set("bretona.filter", "all"); }
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
async function newStore() {
  const s = cap(prompt("Nombre del supermercado o tienda:") || "").slice(0, 30);
  if (!s) return "";
  if (!stores().some((x) => norm(x) === norm(s))) {
    await F.updateDoc(houseRef(), { stores: F.arrayUnion(s) }).catch(failed);
    house = { ...house, stores: [...stores(), s] };
  }
  return stores().find((x) => norm(x) === norm(s)) || s;
}
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
  if (act === "toggle") F.updateDoc(itemRef(it.id), { done: !it.done, doneAt: !it.done ? Date.now() : null }).catch(failed);
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

async function shrink(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);
    return { preview: dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

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

  let text = null, lastErr = null;
  try {
    if (!F.getAI) Object.assign(F, await import(FB + "firebase-ai.js"));
    const ai = F.getAI(app, { backend: new F.GoogleAIBackend() });
    for (const model of geminiModels) {
      try {
        const m = F.getGenerativeModel(ai, { model, generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
        const r = await m.generateContent([PHOTO_PROMPT, { inlineData: { data: img.base64, mimeType: "image/jpeg" } }]);
        text = r.response.text();
        break;
      } catch (e) { lastErr = e; console.warn("Modelo", model, e); }
    }
  } catch (e) { lastErr = e; }

  if (!$("dlg-photo").open) return; // cancelado mientras leía
  if (text == null) {
    const msg = String(lastErr?.message || lastErr || "");
    $("p-status").textContent = !navigator.onLine
      ? "Sin conexión. Para leer fotos hace falta internet."
      : /api-not-enabled|not enabled|PERMISSION_DENIED|403/i.test(msg)
        ? "La lectura de fotos no está activada en Firebase (paso 5 del LEEME)."
        : /quota|429|RESOURCE_EXHAUSTED/i.test(msg)
          ? "Se ha llegado al límite gratuito de fotos por ahora. Prueba dentro de un rato."
          : "No se ha podido leer la foto. Prueba otra vez o con más luz.";
    return;
  }

  let found = [];
  try {
    const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
    const data = JSON.parse(clean);
    found = Array.isArray(data) ? data : (data.productos || data.items || []);
  } catch { found = []; }
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
  $("f-stores").innerHTML = stores().length
    ? stores().map((s) => `<li>${esc(s)}<button data-del-store="${esc(s)}" aria-label="Quitar ${esc(s)}">×</button></li>`).join("")
    : `<li class="muted" style="background:none;padding:0">Aún no hay tiendas.</li>`;
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
$("f-stores").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del-store]"); if (!b) return;
  F.updateDoc(houseRef(), { stores: F.arrayRemove(b.dataset.delStore) }).catch(failed);
});
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
