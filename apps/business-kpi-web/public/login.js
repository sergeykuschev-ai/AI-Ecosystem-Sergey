'use strict';

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || 'Не удалось выполнить запрос.');
    error.code = body.error?.code;
    throw error;
  }
  return body.data;
}

function element(id) { return document.getElementById(id); }

async function initialize() {
  const form = element('login-form');
  const errorBox = element('login-error');
  const submit = element('login-submit');

  try {
    const me = await api('/api/business-kpi/auth/me');
    if (me?.user) {
      window.location.replace('/');
      return;
    }
  } catch {
    // expected when not authenticated
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    try {
      await api('/api/business-kpi/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          externalId: element('login-external-id').value,
          password: element('login-password').value,
        }),
      });
      window.location.replace('/');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.disabled = false;
    }
  });
}

initialize();
