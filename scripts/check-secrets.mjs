import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patterns = [
  ['provider credential', /\bsk[-_][A-Za-z0-9]{24,}\b/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/]
];
export function findings(file, content, known = []) {
  const result = [];
  const base = path.posix.basename(file);
  if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') result.push('private settings file');
  if (/(?:^|\/)(?:private|work|audio-cache)\//.test(file) || /\.(?:pem|key)$/i.test(file)) result.push('private file');
  for (const [label, pattern] of patterns) if (pattern.test(content)) result.push(label);
  if (known.some(value => value && value.length >= 16 && content.includes(value))) result.push('known credential');
  return [...new Set(result)];
}
export function scanRepository(root, { history = false, known = [] } = {}) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const issues = [];
  const inspect = (file, content, location) => {
    for (const label of findings(file, content, known)) issues.push({ file, location, label });
  };
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const file of tracked) {
    inspect(file, git(['show', ':' + file]), 'staged');
    const local = path.join(root, file);
    if (existsSync(local)) inspect(file, readFileSync(local, 'utf8'), 'working file');
  }
  if (history) {
    const objects = git(['rev-list', '--objects', '--all']).trim().split('\n').filter(Boolean);
    for (const record of objects) {
      const space = record.indexOf(' ');
      if (space < 0) continue;
      const hash = record.slice(0, space), file = record.slice(space + 1);
      if (git(['cat-file', '-t', hash]).trim() !== 'blob') continue;
      inspect(file, git(['cat-file', 'blob', hash]), 'history');
    }
  }
  return issues;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const known = ['DEEPSEEK_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVEN_LABS_API_KEY', 'XI_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']
    .map(name => process.env[name]).filter(Boolean);
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const issues = scanRepository(root, { history: process.argv.includes('--history'), known });
    if (issues.length) {
      for (const issue of issues) console.error(issue.file + ' [' + issue.location + ']: ' + issue.label);
      console.error('Credential check blocked this action. Remove private data from the staged files and history.');
      process.exitCode = 1;
    } else console.log('Credential check passed: staged and working files' + (process.argv.includes('--history') ? ', plus Git history.' : '.'));
  } catch {
    console.error('Credential check could not complete. Run it inside the repository and resolve the error before sharing.');
    process.exitCode = 1;
  }
}
