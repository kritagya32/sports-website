// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('VITE_SUPABASE_URL or VITE_SUPABASE_KEY not set. Supabase will not work until .env variables are configured.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
// JavaScript source code
