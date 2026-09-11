/*
 * Carve a section out of src/main.js into its own module.
 *
 *   node tools/extract.mjs <newfile.js> "<start marker>" "<end marker>"
 *
 * Splitting by hand meant discovering each missing binding one page-error at a
 * time. This works the boundary out instead: it reads what the block declares
 * and what the remainder still uses (those become exports), and what the block
 * uses that something else declares (those become imports). The header comment
 * and any tidying are still written by hand afterwards — this only gets the
 * wiring right.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const [outName, startMarker, endMarker] = process.argv.slice(2);
if (!outName || !startMarker || !endMarker) {
  console.error('usage: node tools/extract.mjs <file.js> "<start>" "<end>"');
  process.exit(1);
}

const mainPath = path.join(SRC, 'main.js');
let main = fs.readFileSync(mainPath, 'utf8');

// Snap to the start of the marker's line. A marker can arrive a character short
// — Git Bash rewrites a leading "//" as a path — and slicing from the raw match
// would then clip the first character of the block.
let a = main.indexOf(startMarker);
let b = main.indexOf(endMarker);
if (a < 0 || b < 0 || b <= a) { console.error('markers not found or out of order'); process.exit(1); }
a = main.lastIndexOf('\n', a) + 1;
b = main.lastIndexOf('\n', b) + 1;
const block = main.slice(a, b).replace(/\s+$/, '') + '\n';
const rest = main.slice(0, a) + main.slice(b);

/** Top-level declarations in a chunk of source. */
function declared(src) {
  const names = new Set();
  const re = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(re)) names.add(m[1] || m[2] || m[3]);
  // multi-name declarations: const a=1, b=2;
  for (const m of src.matchAll(/^(?:const|let|var)\s+([^;\n]+)/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  }
  return names;
}

/** Bare identifiers referenced (not property accesses, not after a dot). */
function used(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const names = new Set();
  for (const m of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) names.add(m[2]);
  return names;
}

// What other modules already export, so the block can import from the right place.
const provider = new Map();
for (const f of fs.readdirSync(SRC)) {
  if (f === 'main.js' || !f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
    for (const n of m[1].split(',')) {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (name) provider.set(name, f);
    }
  for (const m of src.matchAll(/^export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm))
    provider.set(m[1], f);
}

/** Every name bound anywhere in a chunk — nested, indented, parameters, catch
 *  clauses, loop variables. Used only to rule names *out* of being external. */
function boundAnywhere(src) {
  const names = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (m[1]) names.add(m[1]);
    for (const p of m[2].split(',')) {
      const n = p.trim().match(/^\.{0,3}\s*([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  }
  // arrow parameters: (a,b)=>  and  a=>
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
    for (const p of m[1].split(',')) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[2]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // destructuring: const {a,b} = / const [a,b] =
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g))
    for (const p of m[1].split(',')) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  return names;
}

const blockDecl  = declared(block);
const blockLocal = boundAnywhere(block);
const restDecl   = declared(rest);
const blockUses  = used(block);
const restUses   = used(rest);

const RESERVED = new Set(['null','true','false','undefined','this','new','return','typeof','void']);
const exports = [...blockDecl].filter(n => restUses.has(n) && !RESERVED.has(n)).sort();

const GLOBALS = new Set(['THREE','window','document','console','Math','Date','JSON','Object','Array',
  'String','Number','Boolean','Promise','Set','Map','performance','localStorage','navigator','screen',
  'requestAnimationFrame','cancelAnimationFrame','setTimeout','setInterval','clearTimeout','clearInterval',
  'Float32Array','Uint8Array','Uint16Array','Int32Array','isNaN','parseInt','parseFloat','fetch',
  'Image','Error','undefined','null','true','false','this','new','typeof','return','function','const',
  'let','var','if','else','for','while','do','break','continue','switch','case','default','try','catch',
  'finally','throw','class','extends','super','import','export','from','of','in','instanceof','delete',
  'void','yield','async','await','get','set','static','AudioContext','webkitAudioContext','Blob','URL']);

const needed = [...blockUses]
  .filter(n => !blockDecl.has(n) && !blockLocal.has(n) && !GLOBALS.has(n));
const fromMain = needed.filter(n => restDecl.has(n)).sort();
const fromModules = new Map();
for (const n of needed) {
  if (restDecl.has(n)) continue;
  const f = provider.get(n);
  if (f && f !== outName) {
    if (!fromModules.has(f)) fromModules.set(f, []);
    fromModules.get(f).push(n);
  }
}

console.log('--- ' + outName + ' ---');
console.log('exports (' + exports.length + '):', exports.join(', ') || '(none)');
for (const [f, names] of fromModules) console.log('import from ' + f + ':', names.sort().join(', '));
const force = process.argv.includes('--force');
if (fromMain.length && !force) {
  console.log('\nSTILL NEEDS FROM main.js (' + fromMain.length + '):', fromMain.join(', '));
  console.log('-> extract those first, or pass them in; nothing written.');
  console.log('   (--force treats them as block-local: object-method shorthand and some loop variables are not recognised by the scan)');
  process.exit(2);
}
if (fromMain.length) console.log('forced, treating as local:', fromMain.join(', '));

const importLines = [...fromModules.entries()]
  .map(([f, names]) => 'import { ' + [...new Set(names)].sort().join(', ') + " } from './" + f + "';")
  .join('\n');

const out = '/* global THREE */\n' + importLines + '\n\n' + block +
            (exports.length ? '\nexport { ' + exports.join(', ') + ' };\n' : '');
fs.writeFileSync(path.join(SRC, outName), out);

const imp = exports.length ? 'import { ' + exports.join(', ') + " } from './" + outName + "';\n" : '';
const anchorEnd = rest.lastIndexOf("';\n", rest.indexOf('\n\n')) ;
// place the new import after the existing import block
const lastImport = rest.lastIndexOf("\nimport ");
const insertAt = rest.indexOf('\n', rest.indexOf(';', lastImport)) + 1;
fs.writeFileSync(mainPath, rest.slice(0, insertAt) + imp + rest.slice(insertAt));
console.log('\nwritten. main.js is now', fs.readFileSync(mainPath, 'utf8').length, 'chars');
