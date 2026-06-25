// Общий Supabase-клиент для обработки звонков (тот же проект и ключ, что в mango.calls.new.js).
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://xyzkneqhggpxstxqbqhs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emtuZXFoZ2dweHN0eHFicWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NTE1MzIsImV4cCI6MjA2MjEyNzUzMn0.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase, SUPABASE_URL };
