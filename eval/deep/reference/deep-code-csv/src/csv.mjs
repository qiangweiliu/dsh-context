export function parseCsv(text) {
  if (text === '') return []
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch === '\r') { if (text[i + 1] === '\n') continue }
    else field += ch
  }
  if (!(text.endsWith('\n') && row.length === 0 && field === '')) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
