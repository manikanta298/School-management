import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
 NODE_ENV: z.enum(['development','test','production']).default('development'),
 PORT: z.coerce.number().int().min(1).max(65535).default(4000),
 DATABASE_URL: z.string().url(), JWT_SECRET: z.string().min(48),
 FRONTEND_ORIGIN: z.string().url(), TRUST_PROXY: z.coerce.number().int().min(0).default(0)
});
export const env = schema.parse(process.env);
if(env.NODE_ENV === 'production' && (!env.FRONTEND_ORIGIN.startsWith('https://') || env.JWT_SECRET.startsWith('replace-'))) throw new Error('Production requires HTTPS and a generated JWT secret');
