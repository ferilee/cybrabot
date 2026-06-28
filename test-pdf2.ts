function sanitizeForWinAnsi(text: string) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25E6\u2043\u2219]/g, '-')
    .replace(/[^\x00-\xFF]/g, '');
}
console.log(sanitizeForWinAnsi('# Test\nIni percobaan RPP dengan emoji 😀 dan tanda – dash.'));
