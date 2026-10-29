// Inspect dist/chatchat.zip: entry count, forbidden folders, required files.
import { execSync } from 'node:child_process';

const raw = execSync('tar -tf dist/chatchat.zip').toString();
const entries = raw
	.split(/\r?\n/)
	.filter(Boolean)
	.map((f) => f.split(String.fromCharCode(92)).join('/'));

console.log('entries:', entries.length);

const forbidden = entries.filter((f) =>
	/(^|\/)(data|node_modules|\.git|_notes|dist|test-results|\.e2e-data)\//.test(f)
);
console.log('forbidden:', forbidden.length ? forbidden.slice(0, 5) : 'none');

const required = [
	'start-chatchat.bat',
	'package.json',
	'package-lock.json',
	'build/index.js',
	'CHANGELOG.md',
	'docs/IMAGE_MODELS.md',
	'src/app.css',
	'workflows/z_image_turbo_lora_t2i.json'
];
for (const need of required) {
	console.log(
		'  ' + need + ':',
		entries.some((f) => f.endsWith(need))
	);
}

const zeroByte = execSync('tar -tvf dist/chatchat.zip')
	.toString()
	.split(/\r?\n/)
	.filter((l) => /^-/.test(l) && /\s0\s/.test(l.slice(0, 40)));
console.log('zero-byte files:', zeroByte.length);
