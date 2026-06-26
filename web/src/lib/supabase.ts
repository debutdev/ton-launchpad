import { createClient } from '@supabase/supabase-js';

// These are NEXT_PUBLIC_ prefixed — safe for the browser.
// The anon key only has READ access via RLS policies.
const sanitize = (val: string | undefined) => (val || '').replace(/[\r\n\t]/g, '').trim();

const supabaseUrl = sanitize(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = sanitize(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10, // High throughput for live trade feeds
    },
  },
});
