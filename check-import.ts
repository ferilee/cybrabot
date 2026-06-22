try {
  const result = await import('./index.ts');
  console.log("Import OK");
} catch(e) {
  console.log("Import failed:", e);
}
