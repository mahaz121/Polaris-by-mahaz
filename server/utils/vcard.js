function escapeVCard(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function employeeVCard(employee, companyInput) {
  const company = typeof companyInput === 'string' ? { name: companyInput } : (companyInput || {});
  const companyName = company.name || '';
  const computedEmail = [employee.computedCompanyEmail, employee.displayEmail].find(value => String(value || '').includes('@'));
  const email = computedEmail || employee.email || '';
  const note = [
    employee.department ? `Department: ${employee.department}` : '',
    employee.extension ? `Extension: ${employee.extension}` : ''
  ].filter(Boolean).join('\n');
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCard(employee.name)}`,
    `N:${escapeVCard(employee.name)};;;;`,
    companyName ? `ORG:${escapeVCard(companyName)}` : '',
    employee.designation ? `TITLE:${escapeVCard(employee.designation)}` : '',
    email ? `EMAIL;TYPE=PREF,INTERNET:${escapeVCard(email)}` : '',
    employee.phone ? `TEL;TYPE=WORK,VOICE:${escapeVCard(employee.phone)}` : '',
    note ? `NOTE:${escapeVCard(note)}` : '',
    company.website ? `URL:${escapeVCard(company.website)}` : '',
    company.address ? `ADR;TYPE=WORK:;;${escapeVCard(company.address)};;;;` : '',
    'END:VCARD'
  ].filter(Boolean).join('\n');
}

function companyVCard(company = {}) {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCard(company.name || 'Company')}`,
    `ORG:${escapeVCard(company.name || '')}`,
    company.phone ? `TEL;TYPE=WORK,VOICE:${escapeVCard(company.phone)}` : '',
    company.email ? `EMAIL;TYPE=PREF,INTERNET:${escapeVCard(company.email)}` : '',
    company.website ? `URL:${escapeVCard(company.website)}` : '',
    company.address ? `ADR;TYPE=WORK:;;${escapeVCard(company.address)};;;;` : '',
    'END:VCARD'
  ].filter(Boolean).join('\n');
}

function hasCompanyContact(company = {}) {
  return ['phone', 'email', 'website', 'address'].some(key => String(company[key] || '').trim());
}

module.exports = { employeeVCard, companyVCard, hasCompanyContact };
