export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function slugDate() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function die(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

export function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

export function replaceTokens(text, tokens) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    tokens[key] !== undefined ? String(tokens[key]) : `{{${key}}}`
  );
}

export function isPlaceholderHeavy(content) {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 8) return true;
  const filled = lines.filter(
    (l) =>
      !l.includes('<!--') &&
      !l.trim().startsWith('- **') &&
      l.trim() !== '-' &&
      l.trim() !== '|' &&
      !/^\|[-:| ]+\|$/.test(l.trim())
  );
  return filled.length < 5;
}
