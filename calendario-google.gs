// BRETONA · lector del calendario de la familia
// Pega este texto en https://script.google.com (Nuevo proyecto) y cambia SOLO la línea de abajo.

const ID_CALENDARIO = 'PEGA_AQUI_EL_ID_DEL_CALENDARIO';

function doGet() {
  const cal = CalendarApp.getCalendarById(ID_CALENDARIO);
  if (!cal) return salida({ error: 'calendario no encontrado' });
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
  return salida({ calendario: cal.getName(), eventos: eventos.length, events: eventos });
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Para probarlo desde el editor: elige "probar" arriba y pulsa Ejecutar.
function probar() {
  const r = JSON.parse(doGet().getContent());
  Logger.log(r.error || ('OK: ' + r.calendario + ' · ' + r.eventos + ' eventos'));
}
