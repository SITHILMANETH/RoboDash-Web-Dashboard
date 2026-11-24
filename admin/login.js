(() => {
  'use strict';
  const err = document.getElementById('err');
  window.handleCredentialResponse = async (response) => {
    err.hidden = true;
    try {
      const r = await fetch('/api/auth/google', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { location.href = '/admin'; return; }
      err.textContent = data.pending
        ? 'Your account is waiting for approval by simaneth@gmail.com.'
        : (data.error || 'Google sign-in failed.');
      err.hidden = false;
    } catch { err.textContent = 'Cannot reach the server.'; err.hidden = false; }
  };
})();
