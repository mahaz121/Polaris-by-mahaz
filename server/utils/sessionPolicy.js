const ADMIN_SESSION_MS = Number(process.env.ADMIN_SESSION_DAYS || 0)
  ? Number(process.env.ADMIN_SESSION_DAYS) * 24 * 60 * 60 * 1000
  : 8 * 60 * 60 * 1000;

const DISPLAY_SESSION_MS = Number(process.env.DISPLAY_SESSION_DAYS || 90) * 24 * 60 * 60 * 1000;

function isDisplayOnlyUser(user = {}, permissions = []) {
  return permissions.length === 1 && permissions[0] === 'display.access';
}

module.exports = {
  ADMIN_SESSION_MS,
  DISPLAY_SESSION_MS,
  isDisplayOnlyUser
};
