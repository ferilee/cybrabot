import { QdrantClient } from '@qdrant/js-client-rest';
import { generateEmbedding } from './ai';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = 'dianyssa_knowledge';

export const qdrantClient = new QdrantClient({
  url: QDRANT_URL,
  ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
});

export async function initQdrant() {
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);

    if (!exists) {
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 768, // text-embedding-004 vector size
          distance: 'Cosine',
        },
      });
      console.log(`Qdrant collection '${COLLECTION_NAME}' created.`);
    }
  } catch (error) {
    console.warn('Failed to initialize Qdrant. Is the server running?', error);
  }
}

export async function addVectorDocument(id: string, title: string, content: string) {
  try {
    const textToEmbed = `${title}\n${content}`;
    const vector = await generateEmbedding(textToEmbed);
    
    if (vector.length === 0) return false;

    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: crypto.randomUUID(),
          vector,
          payload: {
            title,
            content,
            originalId: id,
          },
        },
      ],
    });
    return true;
  } catch (error) {
    console.error('Failed to add vector document:', error);
    return false;
  }
}

export async function deleteVectorDocument(id: string) {
  try {
    await qdrantClient.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          {
            key: 'originalId',
            match: { value: id },
          },
        ],
      },
    });
    return true;
  } catch (error) {
    console.error('Failed to delete vector document:', error);
    return false;
  }
}

export async function searchVectorKnowledge(query: string, limit = 2) {
  try {
    const queryVector = await generateEmbedding(query);
    if (queryVector.length === 0) return [];

    const results = await qdrantClient.search(COLLECTION_NAME, {
      vector: queryVector,
      limit,
      with_payload: true,
    });

    return results.map((res) => ({
      id: res.payload?.originalId as string,
      title: res.payload?.title as string,
      content: res.payload?.content as string,
      score: res.score,
    }));
  } catch (error) {
    console.error('Failed to search vector knowledge:', error);
    return [];
  }
}
