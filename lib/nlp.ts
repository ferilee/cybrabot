import nlp from 'compromise';

export function analyzeText(text: string) {
  const doc = nlp(text);
  
  // Extract intents/entities
  const hasNumbers = doc.values().length > 0;
  const isQuestion = text.includes('?') || doc.questions().length > 0;
  const topics = doc.nouns().out('array');
  const verbs = doc.verbs().out('array');

  return {
    hasNumbers,
    isQuestion,
    topics,
    verbs,
    wordCount: doc.wordCount(),
  };
}
