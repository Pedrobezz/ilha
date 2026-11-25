// Publica a versão atual no GitHub Releases com os 3 arquivos que a atualização automática precisa:
// o instalador, o .blockmap (baixa só o que mudou) e o latest.yml (diz qual é a versão nova).
// Uso: npm run release   (gera o instalador e publica)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const dist = path.join(__dirname, '..', 'dist');
const exe = `Ilha-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map(f => path.join(dist, f));
for (const f of files) if (!fs.existsSync(f)) { console.error(`Faltou ${path.basename(f)}: rode "npm run dist" antes.`); process.exit(1); }

const gh = fs.existsSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'))
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe') : 'gh';
const tag = `v${version}`;
let exists = false;
try { execFileSync(gh, ['release', 'view', tag, '--repo', 'Pedrobezz/ilha'], { stdio: 'ignore' }); exists = true; } catch (_) {}
if (exists) {
  // a release já existe (ex.: criada à mão): só envia/substitui os arquivos
  execFileSync(gh, ['release', 'upload', tag, ...files, '--clobber', '--repo', 'Pedrobezz/ilha'], { stdio: 'inherit' });
} else {
  execFileSync(gh, ['release', 'create', tag, ...files, '--title', `Ilha ${version}`, '--generate-notes', '--repo', 'Pedrobezz/ilha'], { stdio: 'inherit' });
}
console.log(`Publicado: Ilha ${version}`);
