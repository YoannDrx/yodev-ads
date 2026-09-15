/** Neutralize spreadsheet formulas in text while preserving typed numeric values. */
export function spreadsheetText(value: string) {
  // Spreadsheet importers may discard whitespace/control characters before evaluation.
  return /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value)
    ? `'${value}`
    : value
}
