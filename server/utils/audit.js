const fs = require('fs');
const path = require('path');
const { root } = require('./dataStore');

const auditPath = path.join(root, 'data', 'audit.log');

function audit(req, action, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    action,
    userId: req.session?.user?.id || '',
    username: req.session?.user?.username || '',
    ip: req.ip || req.socket?.remoteAddress || '',
    details
  };
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFile(auditPath, `${JSON.stringify(entry)}\n`, () => {});
}

module.exports = { audit };
