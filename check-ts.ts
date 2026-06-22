import { spawnSync } from 'child_process';
const res = spawnSync('bunx', ['tsc', '--noEmit'], { stdio: 'inherit' });
process.exit(res.status || 0);
