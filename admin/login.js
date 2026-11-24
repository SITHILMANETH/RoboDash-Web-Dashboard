(() => {
  'use strict';
  const form = document.getElementById('form');
  const err = document.getElementById('err');
  const btn = document.getElementById('go');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true;
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.value, password: form.password.value })
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { location.href = '/admin'; return; }
      err.textContent = data.error || 'Sign-in failed.'; err.hidden = false;
      form.password.value = ''; form.password.focus();
    } catch { err.textContent = 'Cannot reach the server.'; err.hidden = false; }
    finally { btn.disabled = false; }
  });
})();
