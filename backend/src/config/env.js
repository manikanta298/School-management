import 'dotenv/config';
import { parseEnvironment } from './environment.js';
export const env = parseEnvironment(process.env);
