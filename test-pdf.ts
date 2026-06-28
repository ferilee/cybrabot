import { createPdfDocument } from './lib/document-export';

async function run() {
  try {
    const buf = await createPdfDocument('Judul', '# Test\nIni percobaan RPP dengan emoji 😀 dan tanda – dash.');
    console.log('Success, size:', buf.length);
  } catch (err) {
    console.error('Error generating PDF:', err);
  }
}
run();
