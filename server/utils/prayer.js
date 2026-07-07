const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

const defaultPrayers = () => Object.fromEntries(PRAYERS.map(name => [name, {
  enabled: ['Dhuhr', 'Asr', 'Maghrib'].includes(name),
  adhan: true,
  iqama: true,
  iqamaMinutes: 20,
  audio: '',
  iqamaAudio: ''
}]));

function dateKey(date = new Date()) {
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
}

async function fetchPrayerTimings(profile, date = new Date()) {
  const params = new URLSearchParams({
    method: String(profile.method || 4),
    school: String(profile.school || 0),
    timezonestring: profile.timezone || 'Asia/Riyadh'
  });
  let endpoint;
  if (profile.latitude && profile.longitude) {
    params.set('latitude', profile.latitude);
    params.set('longitude', profile.longitude);
    endpoint = `https://api.aladhan.com/v1/timings/${dateKey(date)}?${params}`;
  } else {
    params.set('city', profile.city || 'Riyadh');
    params.set('country', profile.country || 'Saudi Arabia');
    if (profile.state) params.set('state', profile.state);
    endpoint = `https://api.aladhan.com/v1/timingsByCity/${dateKey(date)}?${params}`;
  }
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`AlAdhan returned HTTP ${response.status}`);
  const body = await response.json();
  const timings = body.data?.timings || {};
  return Object.fromEntries(PRAYERS.map(name => [name, String(timings[name] || '').replace(/\s+\(.+\)$/, '')]));
}

async function profilePrayerState(profile, at = new Date()) {
  const timings = await fetchPrayerTimings(profile, at);
  const today = at.toISOString().slice(0, 10);
  const events = [];
  PRAYERS.forEach(name => {
    const settings = profile.prayers?.[name] || {};
    if (!settings.enabled || !timings[name]) return;
    const [hour, minute] = timings[name].split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    const adhanAt = new Date(at);
    adhanAt.setHours(hour, minute, 0, 0);
    events.push({ type: 'adhan', prayer: name, at: adhanAt.toISOString(), audio: settings.adhan ? settings.audio || '' : '', profileId: profile.id });
    if (settings.iqama) {
      const iqamaAt = new Date(adhanAt.getTime() + Number(settings.iqamaMinutes || 0) * 60000);
      events.push({ type: 'iqama', prayer: name, at: iqamaAt.toISOString(), audio: settings.iqamaAudio || '', profileId: profile.id });
    }
  });
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  const next = events.find(event => new Date(event.at) >= at) || null;
  return { date: today, timings, events, next };
}

module.exports = { PRAYERS, defaultPrayers, fetchPrayerTimings, profilePrayerState };
