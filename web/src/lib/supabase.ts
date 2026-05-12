import { createClient } from '@supabase/supabase-js';

// These are NEXT_PUBLIC_ prefixed — safe for the browser.
// The anon key only has READ access via RLS policies.
const sanitize = (val: string | undefined) => (val || '').replace(/[\r\n\t]/g, '').trim();

const supabaseUrl = sanitize(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wvaeiymtybzykikwdcfe.supabase.co");
const supabaseAnonKey = sanitize(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2YWVpeW10eWJ6eWtpa3dkY2ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDY4MzIsImV4cCI6MjA5MzUyMjgzMn0.Sr1gcAOuEnlgxO8klww-vA1r9wF9MSYcoMVYwJRUVCY");

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10, // High throughput for live trade feeds
    },
  },
});
