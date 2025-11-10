import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env.js";

let _supabase = null;
export function supabaseReady(){ return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }
export async function getSupabase(){
  if(!supabaseReady()) return null;
  if(_supabase) return _supabase;
  const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.1/+esm");
  _supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}
