(() => {
  'use strict';
  const err = document.getElementById('err');
  const form = document.getElementById('login-form');
  const setup = document.getElementById('invite-setup');
  const submit = form.querySelector('button[type="submit"]');

  function showError(message) {
    err.textContent = message;
    err.hidden = false;
  }

  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Signing in...';
    try {
      await post('/api/auth/login', {
        username: form.elements.username.value,
        password: form.elements.password.value
      });
      location.href = '/admin';
    } catch (error) {
      showError(error.message || 'Cannot reach the server.');
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });

  setup.addEventListener('submit', async (event) => {
    event.preventDefault();
    err.hidden = true;
    const password = setup.elements.password.value;
    if (password.length < 12) return showError('Use a password with at least 12 characters.');
    if (password !== setup.elements.confirm.value) return showError('The passwords do not match.');
    const button = setup.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await post('/api/auth/password', { next: password });
      location.href = '/admin';
    } catch (error) {
      showError(error.message || 'Could not set the password.');
      button.disabled = false;
    }
  });

  async function acceptInvite() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('type') !== 'invite') return;
    const accessToken = params.get('access_token') || '';
    const refreshToken = params.get('refresh_token') || '';
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    err.hidden = true;
    try {
      await post('/api/auth/accept-invite', { accessToken, refreshToken });
      form.hidden = true;
      setup.hidden = false;
      document.querySelector('.login h1').textContent = 'Set up admin access';
    } catch (error) {
      showError(error.message || 'The invitation could not be verified. Ask an administrator to send a new one.');
    }
  }

  acceptInvite();
})();
