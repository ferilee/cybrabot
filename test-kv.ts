import { createPdfDocument } from './lib/document-export';

async function test() {
  const content = `
Satuan Pendidikan : SMKN Pasirian
Mata Pelajaran : Matematika
- Nama Guru : Feri Lee
  `;
  const buf = await createPdfDocument('Judul', content);
  console.log('Success PDF size:', buf.length);
}

test().catch(console.error);
