// BRETONA · programa de la familia: lee el calendario, las alertas de pisos y las reservas de viaje del correo.
// Pega este texto en https://script.google.com y cambia SOLO las dos líneas de abajo.

const ID_CALENDARIO = 'PEGA_AQUI_EL_ID_DEL_CALENDARIO';
const CLAVE = 'PEGA_AQUI_LA_CLAVE';   // la misma que pongas en BRETONA (Calendario → Lectura del calendario)

// Correos de alertas que se leen (de los últimos 45 días).
const BUSQUEDA_PISOS = 'from:(idealista.com OR fotocasa.es OR yaencontre.com) newer_than:45d';

// Correos de reservas de viaje (de los últimos 6 meses).
const BUSQUEDA_RESERVAS = 'newer_than:180d -category:social (' +
  'from:(booking.com OR airbnb OR ryanair OR iberia OR vueling OR renfe OR easyjet OR aireuropa OR iryo OR ouigo OR volotea OR binter OR ' +
  'expedia OR edreams OR trainline OR rumbo OR logitravel OR hotels.com OR lufthansa OR flytap OR klm OR airfrance OR alsa OR europcar OR ' +
  'sixt OR hertz OR avis OR goldcar OR centauro OR rentalcars OR paradores OR melia OR nh-hotels OR barcelo OR iberostar OR riu) OR ' +
  'subject:("confirmación de reserva" OR "confirmación de tu reserva" OR "confirmación de su reserva" OR "reserva confirmada" OR ' +
  '"booking confirmation" OR "tarjeta de embarque" OR "boarding pass" OR "tu billete" OR "sus billetes" OR "tus billetes" OR localizador OR itinerario OR ' +
  '"tu reserva" OR "su reserva" OR "your booking" OR "your reservation" OR "e-ticket" OR "confirmación de compra" OR "check-in"))';

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (CLAVE && CLAVE !== 'PEGA_AQUI_LA_CLAVE' && p.k !== CLAVE) return salida({ error: 'clave' });
  const tipo = p.tipo;
  if (tipo === 'reservas') return salida(reservas());
  if (tipo === 'borrar') return salida(borrar(p.ids || ''));
  if (tipo === 'pisos') return salida(pisos(p.releer === '1'));
  if (tipo === 'ruta') return salida(ruta(p.origen || '', p.hora || '08:30'));
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
// releer = true: busca también en la papelera (para volver a leer los datos de pisos ya guardados).
function pisos(releer) {
  const cache = CacheService.getScriptCache();
  const guardado = releer ? null : cache.get('pisos');
  if (guardado) return JSON.parse(guardado);
  const vistos = {};
  const lista = [];
  const correos = {};
  GmailApp.search(BUSQUEDA_PISOS + (releer ? ' in:anywhere' : ''), 0, releer ? 100 : 60).forEach((hilo) => {
    hilo.getMessages().forEach((m) => {
      const de = m.getFrom().toLowerCase();
      const portal = de.indexOf('idealista') >= 0 ? 'idealista' : de.indexOf('fotocasa') >= 0 ? 'fotocasa' : de.indexOf('yaencontre') >= 0 ? 'yaencontre' : '';
      if (!portal) return;
      const fecha = Utilities.formatDate(m.getDate(), 'Europe/Madrid', 'yyyy-MM-dd');
      const html = m.getBody();
      let alguno = false;
      extraer(html, portal).forEach((a) => {
        if (vistos[a.id]) return;
        vistos[a.id] = true;
        alguno = true;
        a.fecha = fecha;
        a.asunto = m.getSubject();
        a.correo = m.getId();
        lista.push(a);
      });
      // El texto del correo con cada anuncio marcado como [[id]], para que Gemini (en BRETONA) lea bien sus datos.
      if (alguno) correos[m.getId()] = textoConMarcas(html, portal);
    });
  });
  const res = { pisos: lista.slice(0, 300), correos: correos };
  if (!releer) { try { cache.put('pisos', JSON.stringify(res), 600); } catch (err) {} }
  return res;
}

// Id y enlace limpio del anuncio al que apunta un enlace del correo (o null si no es un anuncio).
function idDe(url, portal) {
  let dec = String(url).replace(/&amp;/g, '&');
  for (let i = 0; i < 3; i++) { try { dec = decodeURIComponent(dec); } catch (e) { break; } }
  const r = dec.match(PATRONES[portal]);
  if (!r) return null;
  return { id: portal + '-' + r[1], url: portal === 'idealista' ? 'https://www.idealista.com/inmueble/' + r[1] + '/' : r[0] };
}

function limpiar(texto) {
  return texto.replace(/&nbsp;|&#160;/g, ' ').replace(/&euro;|&#8364;/g, '€').replace(/&amp;/g, '&')
    .replace(/&sup2;|&#178;/g, '²').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&#\d+;|&[a-z]+;/g, ' ');
}

function textoConMarcas(html, portal) {
  let h = html.replace(/<(style|head|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<sup>\s*2\s*<\/sup>/gi, '²');
  h = h.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (m, url) => { const r = idDe(url, portal); return r ? ' [[' + r.id + ']] ' : ' '; });
  h = h.replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  h = limpiar(h).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').replace(/(\[\[[^\]]+\]\])(\s*\1)+/g, '$1');
  return h.trim().slice(0, 15000);
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
    const texto = trozo.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<sup>\s*2\s*<\/sup>/gi, '²').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ').replace(/&euro;|&#8364;/g, '€').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const precio = (texto.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})\s?(?:€|euros?)/i) || [])[1] || '';
    const hab = (texto.match(/(\d{1,2})\s?(?:hab\.?|habitaci[oó]n(?:es)?|dormitorios?)/i) || [])[1] || '';
    const m2 = (texto.match(/(\d{2,4})\s?m(?:²|2|\s2\b|etros)/i) || [])[1] || '';
    // Garaje y trastero: true si se mencionan, false si dice "sin garaje", null si no se sabe.
    const garaje = /sin (plaza de )?garaje/i.test(texto) ? false : /garaje|plaza de parking|parking incluido|aparcamiento incluido/i.test(texto) ? true : null;
    const trastero = /sin trastero/i.test(texto) ? false : /trastero/i.test(texto) ? true : null;
    const foto = ((trozo.match(/<img[^>]+src=["'](https:[^"']+)["']/i) || [])[1] || '').replace(/&amp;/g, '&');
    const titulos = (trozo.match(/>([^<>]{12,160})</g) || []).map((t) => t.slice(1, -1).trim())
      .filter((t) => /piso|casa|chalet|[aá]tico|d[uú]plex|apartamento|estudio|vivienda|adosado|planta|calle|avenida|plaza/i.test(t) && !/€/.test(t));
    res.push({
      id: en.id, portal: portal, url: en.url,
      titulo: titulos[0] || '',
      precio: precio ? Number(precio.replace(/[.\s]/g, '')) : null,
      habitaciones: hab ? Number(hab) : null,
      m2: m2 ? Number(m2) : null,
      garaje: garaje,
      trastero: trastero,
      foto: /logo|icon|pixel|track/i.test(foto) ? '' : foto,
    });
  });
  return res;
}

// Manda a la papelera los correos de alertas cuyos pisos ya están en BRETONA.
// Solo toca correos de idealista, Fotocasa o yaencontré; se pueden recuperar de la papelera durante 30 días.
function borrar(ids) {
  let n = 0;
  String(ids).split(',').filter(Boolean).slice(0, 100).forEach((id) => {
    try {
      const m = GmailApp.getMessageById(id);
      if (m && /idealista\.com|fotocasa\.es|yaencontre\.com/i.test(m.getFrom()) && !m.isInTrash()) { m.moveToTrash(); n++; }
    } catch (err) {}
  });
  CacheService.getScriptCache().remove('pisos');
  return { borrados: n };
}

/* ---------- Reservas de viaje (correos) ---------- */
// Devuelve el texto de los correos de reservas; BRETONA (con Gemini) saca de ahí los vuelos, trenes y hoteles.
function reservas() {
  const lista = [];
  GmailApp.search(BUSQUEDA_RESERVAS, 0, 40).forEach((hilo) => {
    hilo.getMessages().slice(-3).forEach((m) => {
      const html = m.getBody();
      // Muchas compañías incluyen los datos de la reserva en formato estructurado (schema.org).
      const ld = (html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [])
        .map((b) => b.replace(/<[^>]+>/g, '').trim()).join('\n').slice(0, 4000);
      const texto = m.getPlainBody().replace(/\s+/g, ' ').slice(0, 5000);
      lista.push({
        id: m.getId(),
        fecha: Utilities.formatDate(m.getDate(), 'Europe/Madrid', 'yyyy-MM-dd'),
        de: m.getFrom(),
        asunto: m.getSubject(),
        datos: ld,
        texto: texto,
      });
    });
  });
  return { correos: lista.slice(0, 60) };
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
function probarReservas() {
  const r = reservas();
  Logger.log('Correos de reservas encontrados: ' + r.correos.length);
  r.correos.slice(0, 10).forEach((c) => Logger.log(c.fecha + ' · ' + c.de + ' · ' + c.asunto + (c.datos ? ' · con datos estructurados' : '')));
}
function probarRuta() {
  Logger.log(JSON.stringify(ruta('Calle de Bravo Murillo 150, Madrid', '08:30')));
}
// Muestra cómo ve BRETONA el primer correo de alertas (para ajustar la lectura si hiciera falta).
function verCorreoPisos() {
  const h = GmailApp.search(BUSQUEDA_PISOS + ' in:anywhere', 0, 1)[0];
  if (!h) { Logger.log('No hay correos de alertas'); return; }
  const m = h.getMessages()[0];
  const de = m.getFrom().toLowerCase();
  const portal = de.indexOf('idealista') >= 0 ? 'idealista' : de.indexOf('fotocasa') >= 0 ? 'fotocasa' : 'yaencontre';
  Logger.log(m.getFrom() + ' · ' + m.getSubject());
  Logger.log(textoConMarcas(m.getBody(), portal).slice(0, 3000));
}
function probarPisos() {
  CacheService.getScriptCache().remove('pisos');
  const r = pisos();
  Logger.log('Pisos encontrados en el correo: ' + r.pisos.length);
  r.pisos.slice(0, 5).forEach((p) => Logger.log(p.portal + ' · ' + (p.precio || '?') + ' € · ' + (p.titulo || '(sin título)') + ' · ' + p.url));
}
