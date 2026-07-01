const express = require('express');
const { readJson, writeJson } = require('../utils/dataStore');
const { emitAllDisplays } = require('../socket');
const router = express.Router();

router.get('/', async (req, res) => res.json(await readJson('settings.json', {})));
router.put('/', async (req, res) => {
  const settings = await readJson('settings.json', {});
  settings.weather = { ...settings.weather, apiKey: req.body.apiKey ?? settings.weather.apiKey, city: req.body.city || settings.weather.city, units: req.body.units || settings.weather.units, lang: req.body.lang || settings.weather.lang };
  settings.ui = { ...settings.ui, theme: req.body.theme || settings.ui.theme || 'light' };
  await writeJson('settings.json', settings);
  await emitAllDisplays();
  res.json(settings);
});
module.exports = router;
