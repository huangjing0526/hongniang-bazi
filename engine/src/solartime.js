// True solar time = standard Beijing time + longitude offset + equation of time.
//
// Equation of time uses the NOAA solar-calculation formulation (Meeus,
// Astronomical Algorithms). The cruder `9.87 sin2B - 7.53 cosB - 1.5 sinB`
// approximation is off by up to ~0.3 min, which is irrelevant against a
// 120-minute 时辰 but shows up when comparing against other tools, so use the
// accurate one in the engine.

const STANDARD_MERIDIAN = 120; // UTC+8

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Julian Day for a UTC calendar date/time. */
export function julianDay(y, m, d, hour = 0, minute = 0) {
  let yy = y;
  let mm = m;
  if (mm <= 2) {
    yy -= 1;
    mm += 12;
  }
  const A = Math.floor(yy / 100);
  const B = 2 - A + Math.floor(A / 4);
  const dayFrac = d + (hour + minute / 60) / 24;
  return (
    Math.floor(365.25 * (yy + 4716)) +
    Math.floor(30.6001 * (mm + 1)) +
    dayFrac +
    B -
    1524.5
  );
}

/**
 * Equation of time in minutes for a given instant.
 * @param {number} jd Julian Day
 */
export function equationOfTimeMinutes(jd) {
  const T = (jd - 2451545.0) / 36525.0; // Julian centuries since J2000.0

  const meanLong = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const L0 = meanLong < 0 ? meanLong + 360 : meanLong;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const meanObliq = 23 + (26 + seconds / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * T));

  const y = Math.tan(rad(obliqCorr / 2)) ** 2;

  const eqTime =
    y * Math.sin(2 * rad(L0)) -
    2 * e * Math.sin(rad(M)) +
    4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
    0.5 * y * y * Math.sin(4 * rad(L0)) -
    1.25 * e * e * Math.sin(2 * rad(M));

  return 4 * deg(eqTime);
}

/**
 * Total minutes to add to standard Beijing time to reach true solar time.
 * @param {{year:number,month:number,day:number,hour:number,minute:number}} beijing standard Beijing time
 * @param {number} longitude east-positive degrees
 */
export function trueSolarOffsetMinutes(beijing, longitude) {
  // Beijing time is UTC+8; convert to UTC for the Julian Day.
  const jd = julianDay(
    beijing.year,
    beijing.month,
    beijing.day,
    beijing.hour - 8,
    beijing.minute,
  );
  const longitudeMinutes = (longitude - STANDARD_MERIDIAN) * 4;
  const eot = equationOfTimeMinutes(jd);
  return {
    longitudeMinutes,
    eotMinutes: eot,
    totalMinutes: longitudeMinutes + eot,
  };
}

/** Shift a wall-clock time by a signed number of minutes, rolling the date. */
export function shiftMinutes(t, minutes) {
  const ms = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute) + Math.round(minutes) * 60000;
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export const fmt = (t) =>
  `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ` +
  `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
