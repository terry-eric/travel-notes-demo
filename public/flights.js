const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_FLIGHT_MINUTES = 24 * 60;
const formatters = new Map();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fieldLabels = {
 airline: '航空公司', number: '航班編號', departureAirport: '出發機場', arrivalAirport: '抵達機場',
 departureDateTime: '當地出發日期與時間', arrivalDateTime: '當地抵達日期與時間',
 departureTimezone: '出發地時區', arrivalTimezone: '抵達地時區', terminal: '航廈',
 bookingReference: '訂位代號', notes: '機票備註',
};

export class FlightValidationError extends Error {
 constructor(message, field) {
  super(message);
  this.name = 'FlightValidationError';
  this.field = field;
 }
}

function textField(raw, field, limit, required = false) {
 const value = raw[field] ?? '';
 if (typeof value !== 'string') throw new FlightValidationError(`${fieldLabels[field]}格式不正確。`, field);
 const text = value.trim();
 if (required && !text) throw new FlightValidationError(`請填寫${fieldLabels[field]}。`, field);
 if (text.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) {
  throw new FlightValidationError(`${fieldLabels[field]}太長或包含無效字元。`, field);
 }
 if (field !== 'notes' && /[\n\r\t]/.test(text)) throw new FlightValidationError(`${fieldLabels[field]}不可換行。`, field);
 return text;
}

function timezone(value, field) {
 if (typeof value !== 'string' || !value.trim() || value.length > 100 || /^[+-]/.test(value)) {
  throw new FlightValidationError(`請填寫有效的${fieldLabels[field] || 'IANA 時區'}，例如 Asia/Taipei。`, field);
 }
 try {
  return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone;
 } catch {
  throw new FlightValidationError(`「${value.trim()}」不是有效的 IANA 時區。`, field);
 }
}

function utcDate(parts) {
 // setUTCFullYear avoids Date.UTC interpreting years 0–99 as 1900–1999.
 const date = new Date(0);
 date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
 date.setUTCHours(parts.hour, parts.minute, parts.second || 0, 0);
 return date;
}

function localParts(value, field) {
 const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
 if (!match) throw new FlightValidationError(`請填寫有效的${fieldLabels[field] || '日期與時間'}。`, field);
 const [, year, month, day, hour, minute] = match.map(Number);
 const parts = { year, month, day, hour, minute, second: 0 };
 const date = utcDate(parts);
 if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day ||
  date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
  throw new FlightValidationError(`${fieldLabels[field] || '日期與時間'}不是有效的日曆日期或時間。`, field);
 }
 return { ...parts, asUTC: date.getTime() };
}

function formatter(zone) {
 if (!formatters.has(zone)) {
  formatters.set(zone, new Intl.DateTimeFormat('en-GB', {
   timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
   era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
 }
 return formatters.get(zone);
}

function zonedParts(instant, zone) {
 const values = Object.fromEntries(formatter(zone).formatToParts(instant).map(part => [part.type, part.value]));
 const year = Number(values.year);
 return {
  year: values.era === 'BC' ? 1 - year : year, month: Number(values.month), day: Number(values.day),
  hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
 };
}

/** Resolve one exact local minute. DST gaps and repeated local times require user correction. */
export function flightInstant(local, zone, field = 'departureDateTime') {
 const wanted = localParts(local, field);
 const canonicalZone = timezone(zone, field === 'arrivalDateTime' ? 'arrivalTimezone' : 'departureTimezone');
 const offsets = new Set();
 // Nearby offsets cover DST transitions and changes across the international date line.
 // Matching every candidate back to the local calendar prevents silently choosing a DST side.
 for (let delta = -48 * HOUR; delta <= 48 * HOUR; delta += 3 * HOUR) {
  const instant = wanted.asUTC + delta;
  offsets.add(utcDate(zonedParts(instant, canonicalZone)).getTime() - instant);
 }
 const candidates = [...offsets].map(offset => wanted.asUTC - offset).filter(instant => {
  const actual = zonedParts(instant, canonicalZone);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].every(key => actual[key] === wanted[key]);
 });
 if (!candidates.length) {
  throw new FlightValidationError(`${fieldLabels[field] || '時間'}在 ${canonicalZone} 因時區或夏令時間切換而不存在，請確認機票上的當地時間。`, field);
 }
 if (candidates.length > 1) {
  throw new FlightValidationError(`${fieldLabels[field] || '時間'}在 ${canonicalZone} 因夏令時間結束而出現兩次，請確認並改填可明確辨識的當地時間。`, field);
 }
 return candidates[0];
}

function validatedDuration(flight) {
 const departure = flightInstant(flight.departureDateTime, flight.departureTimezone, 'departureDateTime');
 const arrival = flightInstant(flight.arrivalDateTime, flight.arrivalTimezone, 'arrivalDateTime');
 const minutes = (arrival - departure) / MINUTE;
 if (minutes <= 0) throw new FlightValidationError('抵達時間必須晚於出發時間；跨時區或跨日航班請填寫機票上的當地日期。', 'arrivalDateTime');
 if (minutes > MAX_FLIGHT_MINUTES) throw new FlightValidationError('單段飛行時間不可超過 24 小時，請確認日期與時區；轉機航班請分開新增。', 'arrivalDateTime');
 // Historic timezone offsets can include seconds. Round up so itinerary placement
 // never schedules a following stop before the flight actually arrives.
 return Math.ceil(minutes);
}

/** Retains only supported flight fields. Required: airports, local datetimes and IANA timezones. */
export function sanitizeFlight(raw) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FlightValidationError('機票資料格式不正確。', 'flight');
 const flight = {
  airline: textField(raw, 'airline', 80), number: textField(raw, 'number', 30),
  departureAirport: textField(raw, 'departureAirport', 160, true), arrivalAirport: textField(raw, 'arrivalAirport', 160, true),
  departureDateTime: textField(raw, 'departureDateTime', 16, true), arrivalDateTime: textField(raw, 'arrivalDateTime', 16, true),
  departureTimezone: timezone(textField(raw, 'departureTimezone', 100, true), 'departureTimezone'),
  arrivalTimezone: timezone(textField(raw, 'arrivalTimezone', 100, true), 'arrivalTimezone'),
  terminal: textField(raw, 'terminal', 80), bookingReference: textField(raw, 'bookingReference', 100), notes: textField(raw, 'notes', 2000),
 };
 validatedDuration(flight);
 return flight;
}

/** Real elapsed flight minutes, independent of browser/device timezone. */
export function flightDuration(raw) {
 return validatedDuration(sanitizeFlight(raw));
}

/** Departure placement on the trip timeline, expressed in the trip's own timezone. */
export function flightTripSchedule(raw, tripTimezone) {
 const flight = sanitizeFlight(raw);
 const zone = timezone(tripTimezone, 'tripTimezone');
 const parts = zonedParts(flightInstant(flight.departureDateTime, flight.departureTimezone), zone);
 const pad = value => String(value).padStart(2, '0');
 return {
  date: `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`,
  time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  duration: validatedDuration(flight),
 };
}

/** Plain text summary; escape this string if placing it in HTML. No booking references are exposed. */
export function formatFlightSummary(raw) {
 const flight = sanitizeFlight(raw);
 const elapsed = validatedDuration(flight), hours = Math.floor(elapsed / 60), minutes = elapsed % 60;
 const duration = [hours ? `${hours} 小時` : '', minutes ? `${minutes} 分鐘` : ''].filter(Boolean).join(' ');
 const airline = [flight.airline, flight.number].filter(Boolean).join(' ');
 return [airline, `${flight.departureAirport} → ${flight.arrivalAirport}`, duration].filter(Boolean).join(' · ');
}

export function commonFlightTimezones() {
 return ['Asia/Taipei', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Singapore',
  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Australia/Sydney', 'UTC'];
}

/** Accessible form fields, names `${prefix}.${field}`. Safe for incomplete draft values. */
export function flightFieldsHtml(raw = {}, { prefix = 'flight', timezones = commonFlightTimezones() } = {}) {
 const safePrefix = /^[a-zA-Z][\w-]{0,50}$/.test(prefix) ? prefix : 'flight';
 const flight = raw && typeof raw === 'object' ? raw : {};
 const input = (field, { type = 'text', placeholder = '', required = false, maxLength = 160, list = false } = {}) => {
  const id = `${safePrefix}-${field}`;
  return `<label class="flight-field" for="${id}"><span>${fieldLabels[field]}${required ? ' <span aria-hidden="true">*</span>' : ''}</span><input id="${id}" name="${safePrefix}.${field}" type="${type}" value="${escapeHtml(flight[field])}"${required ? ' required' : ''}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ''} maxlength="${maxLength}"${list ? ` list="${safePrefix}-timezones" autocapitalize="none" spellcheck="false"` : ''}${type === 'datetime-local' ? ' step="60"' : ''} autocomplete="off"></label>`;
 };
 const zones = [...new Set([...(Array.isArray(timezones) ? timezones : commonFlightTimezones()), flight.departureTimezone, flight.arrivalTimezone].filter(value => typeof value === 'string' && value.length <= 100))];
 return `<fieldset class="flight-fields" aria-describedby="${safePrefix}-help"><legend>機票資訊</legend><p class="flight-help" id="${safePrefix}-help">出發與抵達分別填寫機票上的當地日期、時間和時區；跨日抵達也請選擇正確日期。每日行程會換算成這趟旅行設定的時區；飛行時間依兩地時差計算。</p><div class="flight-grid">
${input('airline', { placeholder: '例如：長榮航空', maxLength: 80 })}${input('number', { placeholder: '例如：BR116', maxLength: 30 })}
${input('departureAirport', { placeholder: '例如：台灣桃園 TPE', required: true })}${input('arrivalAirport', { placeholder: '例如：新千歲 CTS', required: true })}
${input('departureDateTime', { type: 'datetime-local', required: true, maxLength: 16 })}${input('arrivalDateTime', { type: 'datetime-local', required: true, maxLength: 16 })}
${input('departureTimezone', { placeholder: 'Asia/Taipei', required: true, maxLength: 100, list: true })}${input('arrivalTimezone', { placeholder: 'Asia/Tokyo', required: true, maxLength: 100, list: true })}
${input('terminal', { placeholder: '例如：出發 T2／抵達國際線', maxLength: 80 })}${input('bookingReference', { maxLength: 100 })}
<label class="flight-field flight-field--wide" for="${safePrefix}-notes"><span>${fieldLabels.notes}</span><textarea id="${safePrefix}-notes" name="${safePrefix}.notes" rows="3" maxlength="2000">${escapeHtml(flight.notes)}</textarea></label>
</div><datalist id="${safePrefix}-timezones">${zones.map(zone => `<option value="${escapeHtml(zone)}"></option>`).join('')}</datalist></fieldset>`;
}
