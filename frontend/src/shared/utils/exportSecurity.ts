const SPREADSHEET_FORMULA_PREFIX = /^[\s]*[=+\-@]/

export const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

export const escapeSpreadsheetHtmlCell = (value: unknown) => {
  const raw = String(value ?? '')
  const safeValue = SPREADSHEET_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw
  return escapeHtml(safeValue)
}
