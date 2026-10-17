import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFlight, flightInstant, flightDuration, flightTripSchedule, formatFlightSummary, flightFieldsHtml, FlightValidationError } from '../public/flights.js';

const taipeiTokyo = {
 airline: '長榮航空', number: 'BR116', departureAirport: '桃園 TPE', arrivalAirport: '新千歲 CTS',
 departureDateTime: '2027-04-12T10:00', arrivalDateTime: '2027-04-12T14:45',
 departureTimezone: 'Asia/Taipei', arrivalTimezone: 'Asia/Tokyo',
};

test('flight duration uses both local timezones and sanitizes the supported ticket fields', () => {
 const flight = sanitizeFlight({ ...taipeiTokyo, number: ' BR116 ', bookingReference: ' ABC123 ', ignored: 'drop me' });
 assert.equal(flight.number, 'BR116');
 assert.equal(flight.bookingReference, 'ABC123');
 assert.equal(Object.hasOwn(flight, 'ignored'), false);
 assert.equal(flightDuration(flight), 225);
 assert.equal(formatFlightSummary(flight), '長榮航空 BR116 · 桃園 TPE → 新千歲 CTS · 3 小時 45 分鐘');
 assert.doesNotMatch(formatFlightSummary(flight), /ABC123/);
});

test('overnight arrival and international date line flights use absolute instants', () => {
 assert.equal(flightDuration({ ...taipeiTokyo, departureDateTime: '2027-04-12T23:00', arrivalDateTime: '2027-04-13T04:00' }), 240);
 const eastbound = { ...taipeiTokyo, arrivalAirport: '洛杉磯 LAX', departureDateTime: '2027-04-12T23:00', arrivalDateTime: '2027-04-12T20:00', arrivalTimezone: 'America/Los_Angeles' };
 assert.equal(flightDuration(eastbound), 720);
 assert.equal(flightDuration({ ...eastbound, departureAirport: '洛杉磯 LAX', arrivalAirport: '桃園 TPE', departureDateTime: '2027-04-12T23:00', arrivalDateTime: '2027-04-14T04:00', departureTimezone: 'America/Los_Angeles', arrivalTimezone: 'Asia/Taipei' }), 840);
});

test('flight timeline placement uses the trip timezone even across calendar dates', () => {
 assert.deepEqual(flightTripSchedule(taipeiTokyo, 'Asia/Tokyo'), { date: '2027-04-12', time: '11:00', duration: 225 });
 assert.deepEqual(flightTripSchedule(taipeiTokyo, 'Asia/Taipei'), { date: '2027-04-12', time: '10:00', duration: 225 });
 const westbound = { ...taipeiTokyo, departureDateTime: '2027-04-12T23:00', arrivalDateTime: '2027-04-14T04:00', departureTimezone: 'America/Los_Angeles', arrivalTimezone: 'Asia/Taipei' };
 assert.deepEqual(flightTripSchedule(westbound, 'Asia/Taipei'), { date: '2027-04-13', time: '14:00', duration: 840 });
 const eastbound = { ...taipeiTokyo, departureDateTime: '2027-04-12T00:30', arrivalDateTime: '2027-04-11T23:30', arrivalTimezone: 'America/Los_Angeles' };
 assert.deepEqual(flightTripSchedule(eastbound, 'America/Los_Angeles'), { date: '2027-04-11', time: '09:30', duration: 840 });
 assert.throws(() => flightTripSchedule(taipeiTokyo, 'bad zone'), error => error.field === 'tripTimezone');
});

test('Gregorian calendar and minute inputs are validated without normalization', () => {
 assert.doesNotThrow(() => flightInstant('2028-02-29T10:00', 'UTC'));
 for (const local of ['2027-02-29T10:00', '2027-04-31T10:00', '2027-13-01T10:00', '2027-00-01T10:00', '2027-04-00T10:00', '2027-04-12T24:00', '2027-04-12T10:60', '2027-04-12 10:00', '2027-04-12T10:00:00', '0000-04-12T10:00']) {
  assert.throws(() => flightInstant(local, 'UTC'), FlightValidationError, local);
 }
 assert.equal(new Date(flightInstant('0099-04-12T10:00', 'UTC')).getUTCFullYear(), 99);
});

test('DST gaps, repeated hours and whole skipped dates reject rather than guess', () => {
 assert.throws(() => flightInstant('2027-03-14T02:30', 'America/New_York'), /不存在/);
 assert.throws(() => flightInstant('2027-11-07T01:30', 'America/New_York'), /出現兩次/);
 assert.throws(() => flightInstant('2011-12-30T12:00', 'Pacific/Apia'), /不存在/);
 assert.equal(new Date(flightInstant('2027-03-14T03:30', 'America/New_York')).toISOString(), '2027-03-14T07:30:00.000Z');
 assert.equal(flightDuration({ ...taipeiTokyo, departureDateTime: '2027-03-14T01:30', arrivalDateTime: '2027-03-14T03:30', departureTimezone: 'America/New_York', arrivalTimezone: 'America/New_York' }), 60);
});

test('fractional timezone offsets and half-hour DST changes remain accurate', () => {
 assert.equal(new Date(flightInstant('2027-04-12T10:00', 'Asia/Kathmandu')).toISOString(), '2027-04-12T04:15:00.000Z');
 assert.throws(() => flightInstant('2027-04-04T01:45', 'Australia/Lord_Howe'), /出現兩次/);
 assert.throws(() => flightInstant('2027-10-03T02:15', 'Australia/Lord_Howe'), /不存在/);
});

test('arrival ordering, maximum elapsed duration, required fields and timezones are guarded', () => {
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, arrivalDateTime: '2027-04-12T10:00' }), error => error.field === 'arrivalDateTime' && /晚於/.test(error.message));
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, arrivalDateTime: '2027-04-13T11:01' }), /24 小時/);
 assert.equal(flightDuration({ ...taipeiTokyo, arrivalDateTime: '2027-04-13T11:00' }), 1440);
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, departureAirport: '  ' }), error => error.field === 'departureAirport');
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, departureTimezone: 'Mars/Olympus' }), error => error.field === 'departureTimezone');
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, departureTimezone: '+08:00' }), FlightValidationError);
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, number: [] }), FlightValidationError);
 assert.throws(() => sanitizeFlight({ ...taipeiTokyo, notes: 'bad\u0000value' }), FlightValidationError);
 assert.throws(() => sanitizeFlight(null), FlightValidationError);
 assert.throws(() => sanitizeFlight([]), FlightValidationError);
});

test('flight field rendering escapes editable drafts and creates accessible mobile-friendly fields', () => {
 const attack = '"><img src=x onerror=alert(1)>';
 const html = flightFieldsHtml({ ...taipeiTokyo, airline: attack, notes: '</textarea><script>alert(1)</script>', departureTimezone: attack }, { prefix: 'edit-flight', timezones: [attack, 'Asia/Taipei'] });
 assert.doesNotMatch(html, /<img|<script|onerror=alert\(1\)>/);
 assert.match(html, /&quot;&gt;&lt;img/);
 assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
 assert.match(html, /for="edit-flight-departureDateTime"/);
 assert.match(html, /id="edit-flight-departureDateTime" name="edit-flight.departureDateTime" type="datetime-local"/);
 assert.match(html, /name="edit-flight.departureTimezone"/);
 assert.match(html, /<datalist id="edit-flight-timezones">/);
 assert.match(html, /當地日期、時間和時區/);
 assert.doesNotThrow(() => flightFieldsHtml(null));
 assert.doesNotMatch(flightFieldsHtml({}, { prefix: attack }), /<img/);
});
