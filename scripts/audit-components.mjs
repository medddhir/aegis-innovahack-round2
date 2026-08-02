import { access, readFile } from 'node:fs/promises';

const candidates = [
  '/root/Website_Component_Design_Library(1).txt',
  '/root/Website_Component_Design_Library.txt',
  '/mnt/data/Website_Component_Design_Library(1).txt',
  '/mnt/data/Website_Component_Design_Library.txt',
];

async function firstReadable(paths) {
  for (const path of paths) {
    try { await access(path); return path; } catch { /* Continue in documented preference order. */ }
  }
  throw new Error('No Website_Component_Design_Library*.txt file is available.');
}

function field(chunk, label) {
  return chunk.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? '';
}

function parseLibrary(source) {
  const normalized = source.replaceAll('\r', '');
  return normalized.split(/(?=^Component Number:)/m).map(chunk => ({
    number: field(chunk, 'Component Number'),
    name: field(chunk, 'Component Name'),
    url: field(chunk, 'URL'),
    useOn: field(chunk, 'Use On'),
    command: field(chunk, 'Command'),
    code: [...chunk.matchAll(/^Code\d*:\s*([\s\S]*?)(?=^Code\d*:|^Component Number:|\Z)/gm)].map(match => match[1].trim()).filter(Boolean),
  })).filter(entry => entry.name && entry.url);
}

function decodeHTML(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&amp;', '&').replaceAll('&mdash;', '—');
}

function attribute(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
}

function parseImplementations(html) {
  return [...html.matchAll(/<[^>]*\bdata-aegis-component="[^"]+"[^>]*>/g)].map(match => {
    const tag = match[0];
    return {
      name: decodeHTML(attribute(tag, 'data-aegis-component')),
      status: attribute(tag, 'data-component-status'),
      location: attribute(tag, 'data-component-location'),
      mobile: attribute(tag, 'data-mobile'),
      reducedMotion: attribute(tag, 'data-reduced-motion'),
      dead: /(?:^|\s)hidden(?:\s|>|=)|class="[^"]*\bhidden\b/.test(tag),
    };
  });
}

const interactiveNames = new Set([
  'Word Rotate', 'Typing Animation', 'Scroll-Based Velocity', 'Rainbow Button', 'Animated Theme Toggler',
  'Specular Button', 'Animated Beam', 'Animated List', 'Dock — Basic Demo', 'Dock — Navigation Demo',
  'Line Sidebar', 'Motion Number', 'Stepper', 'Option Wheel', 'Border Glow', 'Grid Scan', 'Letter Glitch',
  'Magic Rings', 'Animated Shiny Button',
]);

const libraryPath = await firstReadable(candidates);
const [libraryText, html, matrix, blackLabelJs, ringJs] = await Promise.all([
  readFile(libraryPath, 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../docs/COMPONENT_USAGE_MATRIX.md', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../public/black-label.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/aegis-rings.js', import.meta.url), 'utf8'),
]);

const library = parseLibrary(libraryText);
const implementations = parseImplementations(html);
const byName = new Map();
for (const item of implementations) {
  if (!byName.has(item.name) || (byName.get(item.name).dead && !item.dead)) byName.set(item.name, item);
}
const names = new Set(library.map(item => item.name));
const unexpected = implementations.filter(item => !names.has(item.name));
const used = library.filter(item => byName.has(item.name));
const adapted = used.filter(item => byName.get(item.name).status === 'adapted');
const sourceUsed = used.filter(item => byName.get(item.name).status === 'used');
const rejected = library.filter(item => !byName.has(item.name));
const visible = used.filter(item => !byName.get(item.name).dead);
const interactive = used.filter(item => interactiveNames.has(item.name));
const mobileSafe = used.filter(item => byName.get(item.name).mobile);
const reducedSafe = used.filter(item => byName.get(item.name).reducedMotion);
const undocumented = used.filter(item => !matrix.includes(`| ${String(Number(item.number)).padStart(2, '0')} | ${item.name} |`));
const incomplete = implementations.filter(item => !item.location || !item.mobile || !item.reducedMotion || !['used', 'adapted'].includes(item.status));
const zoneBudgets = [...html.matchAll(/data-zone="([^"]+)"[^>]*data-animation-budget="(\d+)"/g)].map(match => ({ zone: match[1], budget: Number(match[2]) }));

const failures = [];
if (library.length !== 32) failures.push(`Expected 32 populated library entries; found ${library.length}.`);
if (used.length < 29) failures.push(`Only ${used.length} components are implemented; minimum is 29.`);
if (rejected.length > 3) failures.push(`${rejected.length} components are rejected; maximum is 3.`);
if (visible.length < 29) failures.push(`Only ${visible.length} implementations are visibly or interactively reachable.`);
if (unexpected.length) failures.push(`Unknown component markers: ${unexpected.map(item => item.name).join(', ')}.`);
if (incomplete.length) failures.push(`Incomplete implementation metadata: ${incomplete.map(item => item.name).join(', ')}.`);
if (undocumented.length) failures.push(`Usage matrix omissions: ${undocumented.map(item => item.name).join(', ')}.`);
if (zoneBudgets.some(zone => zone.budget > 4)) failures.push('A viewport zone declares more than four active animated behaviours.');
if (!blackLabelJs.includes('IntersectionObserver') || !blackLabelJs.includes("document.hidden")) failures.push('Off-screen and hidden-page animation suspension is not implemented.');
if (!ringJs.includes('sceneCount: 1') || (html.match(/id="magicRingsMount"/g) || []).length !== 1) failures.push('Exactly one WebGL enhancement scene must be declared.');

console.log('AEGIS COMPONENT LIBRARY AUDIT');
console.log(`LIBRARY FILE              ${libraryPath}`);
console.log(`TOTAL LIBRARY COMPONENTS  ${library.length}`);
console.log(`USED                      ${sourceUsed.length}`);
console.log(`ADAPTED                   ${adapted.length}`);
console.log(`REJECTED                  ${rejected.length}`);
console.log(`VISIBLE                   ${visible.length}`);
console.log(`INTERACTIVE               ${interactive.length}`);
console.log(`MOBILE SAFE               ${mobileSafe.length}`);
console.log(`REDUCED-MOTION SAFE       ${reducedSafe.length}`);
console.log(`RENDERING CONTEXTS        1 desktop / 0 mobile fallback`);
console.log(`ZONE ANIMATION BUDGETS    ${zoneBudgets.map(zone => `${zone.zone}:${zone.budget}`).join(', ')}`);

if (failures.length) {
  failures.forEach(failure => console.error(`FAIL: ${failure}`));
  process.exitCode = 1;
} else {
  console.log('COMPONENT AUDIT: PASS');
}
