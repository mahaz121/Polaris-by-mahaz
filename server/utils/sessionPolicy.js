const DAY_MS = 24 * 60 * 60 * 1000;
const REMEMBERED_SESSION_DAYS = Number(process.env.ADMIN_SESSION_DAYS || 365);
const ADMIN_SESSION_MS = REMEMBERED_SESSION_DAYS * DAY_MS;
const DISPLAY_SESSION_MS = Number(process.env.DISPLAY_SESSION_DAYS || 365) * DAY_MS;
const BROWSER_SESSION_MS = 12 * 60 * 60 * 1000;

function isDisplayOnlyUser(user = {}, permissions = []) {
  return permissions.length === 1 && permissions[0] === 'display.access';
}

function sessionLifetimeMs(user = {}, permissions = []) {
  if (isDisplayOnlyUser(user, permissions)) return DISPLAY_SESSION_MS;
  return user.rememberMe === false ? BROWSER_SESSION_MS : ADMIN_SESSION_MS;
}

module.exports = {
  ADMIN_SESSION_MS,
  DISPLAY_SESSION_MS,
  BROWSER_SESSION_MS,
  isDisplayOnlyUser,
  sessionLifetimeMs
};
