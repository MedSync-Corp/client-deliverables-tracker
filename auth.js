// auth.js
import { getSupabase } from './supabaseClient.js';

export async function getCurrentUser() {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

export async function requireAuth(redirect = './login.html') {
  const user = await getCurrentUser();
  if (!user) {
    // remember where to return after login
    sessionStorage.setItem('postLoginRedirect', location.pathname + location.search);
    location.href = redirect;
    throw new Error('Redirecting to login');
  }

  // If the session ends while the page is open (expiry or sign-out elsewhere),
  // redirect instead of letting later queries silently fall back to the anon
  // role and return empty results.
  const supabase = await getSupabase();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && !location.pathname.endsWith('login.html')) {
      sessionStorage.setItem('postLoginRedirect', location.pathname + location.search);
      location.href = redirect;
    }
  });

  return user;
}

export async function signIn(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
  location.href = './login.html';
}

export function wireLogoutButton() {
  document.getElementById('logoutBtn')?.addEventListener('click', signOut);
}
