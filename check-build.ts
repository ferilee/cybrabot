import { spawnSync } from 'child_process';
const result = spawnSync('bun', ['build', 'index.ts']);
if (result.error || result.status !== 0) {
  console.log("Build failed:", result.stderr.toString() || result.stdout.toString());
} else {
  console.log("Build OK");
}
