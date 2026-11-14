import { registerHooks } from 'node:module';
registerHooks({ resolve(s, c, next) { try { return next(s,c); } catch(e) { if (s.startsWith('.') && !s.endsWith('.ts')) return next(s+'.ts',c); throw e; } } });
