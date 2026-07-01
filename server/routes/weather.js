const express = require('express');
const { readJson, writeJson } = require('../utils/dataStore');
const { emitWeather } = require('../socket');
const router = express.Router();

async function fetchWeather(force = false) {
  const settings = await readJson('settings.json', {});
  const weather = settings.weather || {};
  const now = Date.now();
  const last = weather.lastFetched ? new Date(weather.lastFetched).getTime() : 0;
  if (!force && weather.data && now - last < 15 * 60 * 1000) return weather.data;
  const key = weather.apiKey || process.env.OPENWEATHER_API_KEY;
  const city = weather.city || process.env.OPENWEATHER_CITY || 'Riyadh';
  if (!key) return weather.data || { city, temperature: '--', icon: '', description: 'Weather API key not configured' };
  const units = weather.units || 'metric';
  const lang = weather.lang || 'en';
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=${units}&lang=${lang}`;
  const response = await fetch(url);
  if (!response.ok) {
    if (weather.data) return weather.data;
    throw new Error(`OpenWeather error ${response.status}`);
  }
  const json = await response.json();
  const data = {
    city: json.name,
    temperature: Math.round(json.main.temp),
    units,
    description: json.weather?.[0]?.description || '',
    icon: json.weather?.[0]?.icon ? `https://openweathermap.org/img/wn/${json.weather[0].icon}@2x.png` : '',
    fetchedAt: new Date().toISOString()
  };
  settings.weather = { ...weather, data, lastFetched: data.fetchedAt };
  await writeJson('settings.json', settings);
  await emitWeather(data);
  return data;
}

router.get('/', async (req, res) => {
  try { res.json(await fetchWeather(false)); } catch (e) { res.status(502).json({ error: e.message }); }
});
router.post('/refresh', async (req, res) => {
  try { res.json(await fetchWeather(true)); } catch (e) {
    const settings = await readJson('settings.json', {});
    if (settings.weather?.data) return res.json({ ...settings.weather.data, warning: e.message });
    res.status(502).json({ error: e.message });
  }
});
module.exports = { router, fetchWeather };
