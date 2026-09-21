// Jest-only manual mock: exceljs's own bundled "uuid" dependency ships as
// ESM-only, which Jest's CJS transform can't parse. We don't rely on real
// UUIDs in tests (only that exceljs's conditional-formatting code, which
// pulls this in as a side effect of `require('exceljs')`, doesn't crash),
// so a trivial counter-based stand-in is enough.
let counter = 0;

function v4() {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

module.exports = { v4 };
