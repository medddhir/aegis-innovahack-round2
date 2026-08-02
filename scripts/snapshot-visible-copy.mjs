import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const htmlPath = new URL('public/index.html', root);
const lockPath = new URL('docs/VISIBLE_COPY_LOCK.json', root);
const checkMode = process.argv.includes('--check');

const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const excludedTags = new Set(['script', 'style', 'template', 'noscript']);
const decode = value => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|rarr|darr|times);/g, (_, name) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', darr: '↓', times: '×',
  }[name]));
const normalize = value => decode(value).replace(/\s+/g, ' ').trim();
const hash = value => createHash('sha256').update(value).digest('hex');

function parseAttributes(source) {
  const attributes = {};
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = expression.exec(source))) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return attributes;
}

function parseHtml(source) {
  const rootNode = { tag: '#document', attributes: {}, children: [] };
  const stack = [rootNode];
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = token.slice(2, -1).trim().toLowerCase();
      while (stack.length > 1 && stack.at(-1).tag !== tag) stack.pop();
      if (stack.at(-1).tag === tag) stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      const match = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      if (!match) continue;
      const tag = match[1].toLowerCase();
      const node = { tag, attributes: parseAttributes(match[2]), children: [] };
      stack.at(-1).children.push(node);
      if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(node);
      continue;
    }
    stack.at(-1).children.push({ tag: '#text', text: token, attributes: {}, children: [] });
  }
  return rootNode;
}

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}

function textContent(node) {
  if (!node || excludedTags.has(node.tag) || node.attributes?.['aria-hidden'] === 'true') return '';
  if (node.tag === '#text') return node.text;
  return (node.children ?? []).map(textContent).join(' ');
}

const html = await readFile(htmlPath, 'utf8');
const documentNode = parseHtml(html);
const body = find(documentNode, node => node.tag === 'body');
const regionDefinitions = {
  navigation: node => node.tag === 'header' && String(node.attributes.class ?? '').split(/\s+/).includes('site-header'),
  landing: node => node.attributes.id === 'thesis',
  threat: node => node.attributes.id === 'threat',
  authority: node => node.attributes.id === 'authority',
  intervention: node => node.attributes.id === 'intervention',
  controlCentre: node => node.attributes.id === 'control-centre',
  featureProof: node => String(node.attributes.class ?? '').split(/\s+/).includes('feature-proof'),
  proofLab: node => node.attributes.id === 'proof',
  contractProof: node => node.attributes.id === 'contract-enforcement',
  policyNetwork: node => node.attributes.id === 'policy-network',
  closingSystem: node => String(node.attributes.class ?? '').split(/\s+/).includes('final-cta'),
  teamDisclosuresFooter: node => node.tag === 'footer' && !String(node.attributes.class ?? '').includes('red-team'),
  judgeMode: node => node.attributes.id === 'judgeModal',
  redTeamLab: node => node.attributes.id === 'redTeamModal',
};

const regions = Object.fromEntries(Object.entries(regionDefinitions).map(([name, predicate]) => {
  const text = normalize(textContent(find(documentNode, predicate)));
  if (!text) throw new Error(`Visible-copy region ${name} is empty or missing.`);
  return [name, { text, characters: text.length, sha256: hash(text) }];
}));
const globalText = normalize(textContent(body));
const snapshot = {
  schemaVersion: 1,
  source: 'public/index.html',
  global: { text: globalText, characters: globalText.length, sha256: hash(globalText) },
  regions,
};

if (checkMode) {
  const locked = JSON.parse(await readFile(lockPath, 'utf8'));
  const currentComparable = JSON.stringify({ global: snapshot.global.text, regions: Object.fromEntries(Object.entries(snapshot.regions).map(([name, value]) => [name, value.text])) });
  const lockedComparable = JSON.stringify({ global: locked.global.text, regions: Object.fromEntries(Object.entries(locked.regions).map(([name, value]) => [name, value.text])) });
  if (currentComparable !== lockedComparable) throw new Error('VISIBLE COPY LOCK FAILED: existing product copy changed.');
  process.stdout.write(`VISIBLE COPY LOCK: PASS (${snapshot.global.characters} characters across ${Object.keys(regions).length} regions)\n`);
} else {
  await writeFile(lockPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`Visible copy snapshot written: ${snapshot.global.characters} characters across ${Object.keys(regions).length} regions.\n`);
}
