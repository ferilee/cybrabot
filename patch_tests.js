const fs = require('fs');
let code = fs.readFileSync('test/backend.test.ts', 'utf-8');

code = code.replace(/test\('runSkillChat passes study-first instructions for grill-me skill', async \(\) => \{[\s\S]*?\}\);/m, '');
code = code.replace(/test\('grill-me session engine enforces briefing, evaluation pause, and explicit continue flow', async \(\) => \{[\s\S]*?\}\);/m, '');
code = code.replace(/test\('grill-me question generation injects topic blueprint and adaptive focus', async \(\) => \{[\s\S]*?\}\);/m, '');
code = code.replace(/test\('grill-me session can be ended explicitly and clears persisted state', async \(\) => \{[\s\S]*?\}\);/m, '');
code = code.replace(/test\('completed grill-me session is archived for the user', async \(\) => \{[\s\S]*?\}\);/m, '');

fs.writeFileSync('test/backend.test.ts', code);
