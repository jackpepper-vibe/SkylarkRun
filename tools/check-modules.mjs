/*
 * Static checks the headless suite cannot make.
 *
 *   node tools/check-modules.mjs
 *
 * Two faults slipped through the split into modules and both were invisible
 * until a button was pressed:
 *
 *   1. Assigning to an imported binding. ES modules hand out live *read-only*
 *      bindings, so `permState = "unsupported"` throws at runtime — but only
 *      on the code path that runs it, which in that case was the Fly button.
 *   2. Using a name the module never imported. Same story: fine until reached.
 *
 * Both are cheap to find by reading the source, so they are found here rather
 * than waiting for someone to click the right thing.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

const GLOBALS = new Set(('THREE window document console Math Date JSON Object Array String Number ' +
  'Boolean Promise Set Map WeakMap performance localStorage navigator screen location history ' +
  'requestAnimationFrame cancelAnimationFrame setTimeout setInterval clearTimeout clearInterval ' +
  'Float32Array Uint8Array Uint16Array Int32Array Int8Array isNaN isFinite parseInt parseFloat ' +
  'fetch Image Error TypeError RangeError undefined NaN Infinity globalThis self ' +
  'AudioContext webkitAudioContext DeviceOrientationEvent Blob URL FileReader Event CustomEvent ' +
  'encodeURIComponent decodeURIComponent structuredClone queueMicrotask').split(' '));

const KEYWORDS = new Set(('if else for while do break continue switch case default try catch finally ' +
  'throw return function const let var class extends super new typeof instanceof delete void in of ' +
  'import export from as async await yield this null true false get set static debugger with').split(' '));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Source with comments and string/template bodies blanked out. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function importedNames(src) {
  const names = new Map();                       // name -> module specifier
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.set(n, m[2]);
    }
  }
  return names;
}

function boundLocally(src) {
  const names = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // `let W=0,H=0,DPR=1;` declares three names, not one, and a declaration may
  // wrap across lines — so read to the semicolon and split on top-level commas,
  // rather than stopping at the first '=' or at the end of the line.
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([^;]+);/g)) {
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  }
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (m[1]) names.add(m[1]);
    for (const p of m[2].split(',')) {
      const n = p.trim().match(/^\.{0,3}\s*([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  }
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
    for (const p of m[1].split(',')) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/gm)) names.add(m[2]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g))
    for (const p of m[1].split(',')) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  // object-literal method shorthand and property keys
  for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[(:]/gm)) names.add(m[1]);
  for (const m of src.matchAll(/(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  return names;
}

function exportedBy(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g))
    for (const n of m[1].split(',')) {
      const t = n.trim().split(/\s+as\s+/).pop().trim();
      if (t) names.add(t);
    }
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^;\n]+)/gm)) {
    // `export const A = 1, B = 2;` exports both, not just the first.
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  }
  for (const m of src.matchAll(/^export\s+(?:function|class)\s+([A-Za-z_$][\w$]*)/gm))
    names.add(m[1]);
  return names;
}

let problems = 0;
const files = walk(SRC);
const exportsOf = new Map(files.map(f => [f, exportedBy(f)]));

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = strip(raw);
  const rel = path.relative(process.cwd(), file);
  // Imports are read from the raw text: strip() blanks string bodies, which
  // would erase the module specifiers and make every import invisible.
  const imported = importedNames(raw);
  const local = boundLocally(src);

  // --- 1. assignment to an imported binding ---
  for (const [name, spec] of imported) {
    const assign = new RegExp('(?<![.\\w$])' + name + '\\s*(?:=(?!=)|\\+=|-=|\\*=|/=|\\+\\+|--)', 'g');
    for (const m of src.matchAll(assign)) {
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`FAIL  ${rel}:${line}  assigns to imported binding '${name}' (from ${spec})`);
      problems++;
    }
  }

  // --- 3. assignment to a name that is neither declared here nor imported ---
  // `_hatBuf = b` where _hatBuf was left behind in another module: a straight
  // ReferenceError under a module's implicit strict mode, and one no module
  // exports, so check 2 cannot see it.
  {
    const localNames = boundLocally(src);
    const seenAssign = new Set();
    for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*=(?!=)/gm)) {
      const n = m[2];
      if (seenAssign.has(n) || localNames.has(n) || imported.has(n) ||
          GLOBALS.has(n) || KEYWORDS.has(n)) continue;
      seenAssign.add(n);
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`FAIL  ${rel}:${line}  assigns to undeclared '${n}'`);
      problems++;
    }
  }

  // --- 2. free identifier that is neither imported, local, nor a global ---
  // The import and export statements themselves are not uses, so blank them
  // out first or every imported name reports itself.
  const body = src
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"]\s*;?/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/import\s+[^;\n]*from\s*['"][^'"]*['"]\s*;?/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/export\s*\{[^}]*\}\s*;?/g, m => m.replace(/[^\n]/g, ' '));
  const declaredHere = new Set([...local, ...imported.keys()]);
  const seen = new Set();
  // `get af(){...}` names a property, not a reference to something else.
  for (const m of body.matchAll(/(?<!\bget\s)(?<!\bset\s)(^|[^.\w$?])([A-Za-z_$][\w$]*)(?!\s*:)/gm)) {
    const n = m[2];
    if (seen.has(n) || declaredHere.has(n) || GLOBALS.has(n) || KEYWORDS.has(n)) continue;
    seen.add(n);
    // only report if some module does export it — otherwise it is almost
    // certainly a property name the scan mistook for an identifier
    const owner = files.find(f => exportsOf.get(f).has(n));
    if (owner) {
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`FAIL  ${rel}:${line}  uses '${n}' without importing it ` +
                  `(exported by ${path.relative(SRC, owner).replace(/\\/g, '/')})`);
      problems++;
    }
  }
}

console.log(problems ? `\n${problems} problem(s)` : '\nno module wiring problems');
process.exit(problems ? 1 : 0);
