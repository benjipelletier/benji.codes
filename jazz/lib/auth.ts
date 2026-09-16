import 'server-only';

// Auth moved to shared infrastructure when longku needed the same session.
// Re-exported here so jazz's existing imports keep working unchanged.
export { auth } from '@/lib/auth';
