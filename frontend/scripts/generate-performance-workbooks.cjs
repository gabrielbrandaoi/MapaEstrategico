const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const outputDirectory = process.argv[2];
if (!outputDirectory || process.argv.length !== 3) {
  throw new Error('Uso: node scripts/generate-performance-workbooks.cjs <diretorio-de-saida>');
}

fs.mkdirSync(outputDirectory, { recursive: true });

for (const count of [100, 1000, 5000]) {
  const rows = [['Nome', 'Tipo', 'Latitude', 'Longitude', 'UF']];
  for (let index = 0; index < count; index++) {
    rows.push([
      `Sintetico ${index}`,
      index % 10 === 0 ? 'tutor' : 'bolsista',
      -23 + (index % 100) * 0.01,
      -46 + Math.floor(index / 100) * 0.01,
      'SP',
    ]);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Pontos');
  XLSX.writeFile(workbook, path.join(outputDirectory, `perf-${count}.xlsx`));
  console.log(`Gerado: perf-${count}.xlsx (${count} participantes sinteticos)`);
}
