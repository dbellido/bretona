// BRETONA · programa de la familia: lee el calendario y los correos de alertas de pisos.
// Pega este texto en https://script.google.com y cambia SOLO la línea de abajo.

const ID_CALENDARIO = 'PEGA_AQUI_EL_ID_DEL_CALENDARIO';

// Correos de alertas que se leen (de los últimos 45 días).
const BUSQUEDA_PISOS = 'from:(idealista.com OR fotocasa.es OR yaencontre.com) newer_than:45d';

function doGet(e) {
  const tipo = e && e.parameter && e.parameter.tipo;
  if (tipo === 'pisos') return salida(pisos());
  if (tipo === 'ruta') return salida(ruta(e.parameter.origen || '', e.parameter.hora || '08:30'));
  return salida(calendario());
}

/* ---------- Calendario ---------- */
function calendario() {
  const cal = CalendarApp.getCalendarById(ID_CALENDARIO);
  if (!cal) return { error: 'calendario no encontrado' };
  const zona = cal.getTimeZone();
  const f = (d) => Utilities.formatDate(d, zona, "yyyy-MM-dd'T'HH:mm");
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 120 * 864e5);
  const hasta = new Date(hoy.getTime() + 400 * 864e5);
  const eventos = cal.getEvents(desde, hasta).slice(0, 2000).map((ev) => ({
    id: ev.getId() + '_' + ev.getStartTime().getTime(),
    title: ev.getTitle(),
    start: f(ev.getStartTime()),
    end: f(ev.getEndTime()),
    allDay: ev.isAllDayEvent(),
    location: ev.getLocation(),
    description: (ev.getDescription() || '').slice(0, 500),
  }));
  return { calendario: cal.getName(), eventos: eventos.length, events: eventos };
}

/* ---------- Pisos (alertas por correo) ---------- */
function pisos() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('pisos');
  if (guardado) return JSON.parse(guardado);
  const vistos = {};
  const lista = [];
  GmailApp.search(BUSQUEDA_PISOS, 0, 60).forEach((hilo) => {
    hilo.getMessages().forEach((m) => {
      const de = m.getFrom().toLowerCase();
      const portal = de.indexOf('idealista') >= 0 ? 'idealista' : de.indexOf('fotocasa') >= 0 ? 'fotocasa' : de.indexOf('yaencontre') >= 0 ? 'yaencontre' : '';
      if (!portal) return;
      const fecha = Utilities.formatDate(m.getDate(), 'Europe/Madrid', 'yyyy-MM-dd');
      extraer(m.getBody(), portal).forEach((a) => {
        if (vistos[a.id]) return;
        vistos[a.id] = true;
        a.fecha = fecha;
        a.asunto = m.getSubject();
        lista.push(a);
      });
    });
  });
  const res = { pisos: lista.slice(0, 300) };
  try { cache.put('pisos', JSON.stringify(res), 600); } catch (err) {}
  return res;
}

const PATRONES = {
  idealista: /https?:\/\/(?:www\.)?idealista\.com\/(?:[a-z]{2}\/)?inmueble\/(\d+)/,
  fotocasa: /https?:\/\/(?:www\.)?fotocasa\.es\/[^\s"'<>?#]*?\/(\d{6,})\/d/,
  yaencontre: /https?:\/\/(?:www\.)?yaencontre\.com\/[^\s"'<>?#]*?(\d{6,})[^\s"'<>?#]*/,
};

// Busca los anuncios de un correo: enlaces a fichas de inmueble y, alrededor, precio, foto, habitaciones y m².
function extraer(html, portal) {
  const patron = PATRONES[portal];
  const enlaces = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let url = m[1].replace(/&amp;/g, '&');
    let dec = url;
    for (let i = 0; i < 3; i++) { try { dec = decodeURIComponent(dec); } catch (e) { break; } }
    const r = dec.match(patron);
    if (!r) continue;
    const id = portal + '-' + r[1];
    if (enlaces.length && enlaces[enlaces.length - 1].id === id) continue;
    enlaces.push({ id: id, pos: m.index, url: portal === 'idealista' ? 'https://www.idealista.com/inmueble/' + r[1] + '/' : r[0] });
  }
  const res = [];
  const hechos = {};
  enlaces.forEach((en, i) => {
    if (hechos[en.id]) return;
    hechos[en.id] = true;
    // El trozo del correo de este anuncio: desde su enlace hasta el enlace del siguiente anuncio distinto.
    let fin = html.length;
    for (let j = i + 1; j < enlaces.length; j++) if (enlaces[j].id !== en.id) { fin = enlaces[j].pos; break; }
    const inicio = en.pos;
    const trozo = html.slice(inicio, Math.min(fin, en.pos + 6000));
    const texto = trozo.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ').replace(/&euro;|&#8364;/g, '€').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const precio = (texto.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})\s?€/) || [])[1] || '';
    const hab = (texto.match(/(\d{1,2})\s?(?:hab\.?|habitaci[oó]n(?:es)?|dormitorios?)/i) || [])[1] || '';
    const m2 = (texto.match(/(\d{2,4})\s?m(?:²|2)/i) || [])[1] || '';
    const foto = ((trozo.match(/<img[^>]+src=["'](https:[^"']+)["']/i) || [])[1] || '').replace(/&amp;/g, '&');
    const titulos = (trozo.match(/>([^<>]{12,160})</g) || []).map((t) => t.slice(1, -1).trim())
      .filter((t) => /piso|casa|chalet|[aá]tico|d[uú]plex|apartamento|estudio|vivienda|adosado|planta|calle|avenida|plaza/i.test(t) && !/€/.test(t));
    res.push({
      id: en.id, portal: portal, url: en.url,
      titulo: titulos[0] || '',
      precio: precio ? Number(precio.replace(/[.\s]/g, '')) : null,
      habitaciones: hab ? Number(hab) : null,
      m2: m2 ? Number(m2) : null,
      foto: /logo|icon|pixel|track/i.test(foto) ? '' : foto,
    });
  });
  return res;
}

/* ---------- Trayecto en transporte público ---------- */
const DESTINOS = {
  'Nuevos Ministerios': 'Estación de Nuevos Ministerios, Madrid',
  'Chamartín': 'Estación de Madrid-Chamartín-Clara Campoamor, Madrid',
};

// Próximo día laborable a la hora indicada, en hora de Madrid.
function proximaSalida(hora) {
  let d = new Date(Date.now() + 864e5);
  while (['Sat', 'Sun'].indexOf(Utilities.formatDate(d, 'Europe/Madrid', 'EEE')) >= 0) d = new Date(d.getTime() + 864e5);
  const dia = Utilities.formatDate(d, 'Europe/Madrid', 'yyyy-MM-dd');
  const zona = Utilities.formatDate(d, 'Europe/Madrid', 'XXX');
  return new Date(dia + 'T' + (/^\d{2}:\d{2}$/.test(hora) ? hora : '08:30') + ':00' + zona);
}

function ruta(origen, hora) {
  origen = String(origen).slice(0, 200);
  if (!origen) return { error: 'sin origen' };
  const cache = CacheService.getScriptCache();
  const clave = 'r:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, origen + '|' + hora));
  const guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);
  const salidaHora = proximaSalida(hora);
  const tiempos = {};
  let desde = '';
  Object.keys(DESTINOS).forEach((nombre) => {
    try {
      const r = Maps.newDirectionFinder().setOrigin(origen).setDestination(DESTINOS[nombre])
        .setMode(Maps.DirectionFinder.Mode.TRANSIT).setDepart(salidaHora).setLanguage('es').getDirections();
      if (r.status === 'OK' && r.routes.length) {
        const tramo = r.routes[0].legs[0];
        tiempos[nombre] = Math.round(tramo.duration.value / 60);
        desde = desde || tramo.start_address;
      }
    } catch (err) {}
  });
  const nombres = Object.keys(tiempos);
  if (!nombres.length) return { error: 'sin ruta', origen: origen };
  const mejor = nombres.sort((a, b) => tiempos[a] - tiempos[b])[0];
  const res = { origen: origen, desde: desde, tiempos: tiempos, mejor: { destino: mejor, min: tiempos[mejor] } };
  try { cache.put(clave, JSON.stringify(res), 21600); } catch (err) {}
  return res;
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Para probar desde el editor: elige la función arriba y pulsa Ejecutar.
function probar() {
  const r = calendario();
  Logger.log(r.error || ('Calendario OK: ' + r.calendario + ' · ' + r.eventos + ' eventos'));
}
function probarRuta() {
  Logger.log(JSON.stringify(ruta('Calle de Bravo Murillo 150, Madrid', '08:30')));
}
function probarPisos() {
  CacheService.getScriptCache().remove('pisos');
  const r = pisos();
  Logger.log('Pisos encontrados en el correo: ' + r.pisos.length);
  r.pisos.slice(0, 5).forEach((p) => Logger.log(p.portal + ' · ' + (p.precio || '?') + ' € · ' + (p.titulo || '(sin título)') + ' · ' + p.url));
}
