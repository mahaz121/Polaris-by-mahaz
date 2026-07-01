const express = require('express');
const { buildDisplayPayload } = require('../utils/publicPayload');
const router = express.Router();
router.get('/:id/data', async (req, res) => {
  const payload = await buildDisplayPayload(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Display not found' });
  res.json(payload);
});
router.get('/:id/orgchart', async (req, res) => {
  const payload = await buildDisplayPayload(req.params.id, false);
  if (!payload) return res.status(404).json({ error: 'Display not found' });
  if (payload.display?.displayMode !== 'orgchart') return res.status(400).json({ error: 'Display is not an organization chart' });
  res.json({
    display: payload.display,
    settings: payload.settings,
    weather: payload.weather,
    orgChart: payload.orgChart
  });
});
module.exports = router;
