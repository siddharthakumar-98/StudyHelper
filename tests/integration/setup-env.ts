import { config } from "dotenv";
import { assertLocalSupabaseUrl } from "../localOnly";

config({ path: ".env.test.local", quiet: true });

// Runs before every integration file: they reset and seed the database (R39).
assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
