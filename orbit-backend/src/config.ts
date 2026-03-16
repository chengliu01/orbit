import 'dotenv/config';
import { resolve } from 'path';

export const config = {
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT ?? resolve(process.env.HOME ?? '~', 'workspace/orbit'),
  DB_PATH: process.env.DB_PATH ?? './data/orbit.db',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
};
