import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  || ''
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Returns null if not configured — app falls back to REST API
export const supabase =
  supabaseUrl && !supabaseUrl.includes('your-project')
    ? createClient(supabaseUrl, supabaseKey)
    : null

export default supabase
