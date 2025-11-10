<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sign in • Client Deliverables</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gray-50 flex items-center justify-center p-6">
  <div class="w-full max-w-sm bg-white shadow rounded-xl p-6">
    <h1 class="text-xl font-semibold mb-4">Sign in</h1>
    <form id="loginForm" class="space-y-3">
      <div>
        <label class="block text-sm text-gray-700 mb-1">Email</label>
        <input id="email" name="email" type="email" required
               class="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200" />
      </div>
      <div>
        <label class="block text-sm text-gray-700 mb-1">Password</label>
        <input id="password" name="password" type="password" required
               class="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200" />
      </div>
      <p id="loginError" class="text-sm text-red-600 h-5"></p>
      <button type="submit"
              class="w-full bg-indigo-600 text-white rounded-lg py-2 hover:bg-indigo-700">
        Sign in
      </button>
    </form>
  </div>

  <script type="module">
    import { signIn, getCurrentUser } from './auth.js';

    document.addEventListener('DOMContentLoaded', async () => {
      // If already signed in, bounce to the app
      const user = await getCurrentUser();
      if (user) {
        location.href = sessionStorage.getItem('postLoginRedirect') || './index.html';
        return;
      }

      const form = document.getElementById('loginForm');
      const err  = document.getElementById('loginError');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        const email = form.email.value.trim();
        const password = form.password.value.trim();
        try {
          await signIn(email, password);
          const dest = sessionStorage.getItem('postLoginRedirect') || './index.html';
          location.href = dest;
        } catch (ex) {
          err.textContent = ex?.message || 'Sign-in failed';
        }
      });
    });
  </script>
</body>
</html>
