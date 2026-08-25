'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicRoot = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const javascript = fs.readFileSync(path.join(publicRoot, 'app.js'), 'utf8');
const { STATIC_FILES } = require('../http/static_handler');

test('index.html hides authenticated shell until session is confirmed', () => {
  assert.match(html, /<body[^>]*class="[^"]*auth-loading[^"]*"/);
});

test('app.js redirects to login when session check fails', () => {
  assert.match(javascript, /function redirectToLogin\(\)/);
  assert.match(javascript, /redirectToLogin\(\);/);
  assert.match(javascript, /api\('\/api\/business-kpi\/auth\/me'\)/);
});

test('app.js re-validates session after bfcache pageshow', () => {
  assert.match(javascript, /window\.addEventListener\('pageshow'/);
  assert.match(javascript, /event\.persisted/);
});

test('static handler serves login page and required assets', () => {
  assert.ok(STATIC_FILES['/login.html'], 'login.html route missing');
  assert.ok(STATIC_FILES['/login'], 'login route missing');
  assert.ok(STATIC_FILES['/login.js'], 'login.js route missing');
  assert.ok(STATIC_FILES['/assets/miska-logo.jpg'], 'logo asset route missing');
});

test('app.js maps roles to human labels', () => {
  assert.match(javascript, /OWNER:\s*['"]Владелец['"]/);
  assert.match(javascript, /SELLER:\s*['"]Продавец['"]/);
});

test('app.js guards routes by role', () => {
  assert.match(javascript, /function canViewRoute\(route\)/);
  assert.match(javascript, /if \(!canViewRoute\(routeId\)\)/);
});

test('app.js hides admin navigation for seller', () => {
  assert.match(javascript, /renderSidebar\(\)/);
  assert.match(javascript, /link\.hidden = !canViewRoute\(route\)/);
});

test('app.js locks seller shift form to own employee', () => {
  assert.match(javascript, /isSeller = state\.currentUser\?\.role === 'SELLER'/);
  assert.match(javascript, /'shift-employee'\)\.disabled = Boolean\(shift\) \|\| isSeller/);
  assert.match(javascript, /state\.currentUser\?\.employeeId/);
});

test('app.js disables shift inputs when user cannot edit', () => {
  assert.match(javascript, /const editable = shift \? canEditShift\(shift\) : canCreateShift\(\)/);
  assert.match(javascript, /element\(id\)\.readOnly = historical \|\| !editable/);
});

test('login page redirects authenticated users to portal', () => {
  const loginJs = fs.readFileSync(path.join(publicRoot, 'login.js'), 'utf8');
  assert.match(loginJs, /api\('\/api\/business-kpi\/auth\/me'\)/);
  assert.match(loginJs, /window\.location\.replace\('\/'\)/);
});
