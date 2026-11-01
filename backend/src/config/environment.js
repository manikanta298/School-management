import { z } from 'zod';

// Render-generated secrets contain 32 random bytes encoded as base64 (44 characters).
const strongSecret = value => value.length >= 48 || (
 /^[A-Za-z0-9+/]{43}=$/.test(value) &&
 Buffer.from(value, 'base64').length === 32 &&
 Buffer.from(value, 'base64').toString('base64') === value
);
const schema = z.object({
 NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
 PORT: z.coerce.number().int().min(1).max(65535).default(4000),
 DATABASE_URL: z.string().url().refine(value => /^postgres(ql)?:/.test(value)),
 JWT_SECRET: z.string().refine(strongSecret),
 FRONTEND_ORIGIN: z.string().url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
   url.pathname === '/' && !url.search && !url.hash;
 }).transform(value => new URL(value).origin),
 TRUST_PROXY: z.coerce.number().int().min(0).default(0)
});

export function parseEnvironment(source) {
 const result = schema.safeParse(source);
 if (!result.success) {
  const names = [...new Set(result.error.issues.map(issue => issue.path[0]))];
  throw new Error(`Invalid or missing environment settings: ${names.join(', ')}. Set these in Render > service > Environment (or backend/.env locally). See docs/deployment/render.md. Values are intentionally omitted.`);
 }
 const env = result.data;
 if (env.NODE_ENV === 'production' &&
  (!env.FRONTEND_ORIGIN.startsWith('https://') || env.JWT_SECRET.startsWith('replace-'))) {
  throw new Error('Production requires an HTTPS FRONTEND_ORIGIN and a generated JWT_SECRET. See docs/deployment/render.md.');
 }
 return env;
}
