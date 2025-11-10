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
