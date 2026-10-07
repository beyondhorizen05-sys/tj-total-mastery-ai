import { m001 } from './migrations/001_core.js';
import { m002 } from './migrations/002_models_secrets.js';
import { m003 } from './migrations/003_agents_tasks.js';
import { m004 } from './migrations/004_workflows.js';
import { m005 } from './migrations/005_memory.js';
import { m006 } from './migrations/006_connectors.js';

export interface Migration { version: number; name: string; up: string[] }

export const MIGRATIONS: Migration[] = [m001, m002, m003, m004, m005, m006];
