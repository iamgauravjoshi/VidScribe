export const RETRIEVAL_EVALUATION = {
  version: 1,
  corpus: 'synthetic-local-research-transcript',
  topK: 3,
  minimumRecallAtK: 0.75,
  cases: [
    {
      id: 'rank-local-full-text-results',
      question: 'Where are full text search matches ranked?',
      relevantChunkIndexes: [0],
      expectedHit: true,
    },
    {
      id: 'cite-the-supporting-video-moment',
      question: 'How can the reader jump to the video moment that supports an answer?',
      relevantChunkIndexes: [1],
      expectedHit: true,
    },
    {
      id: 'keep-transcript-private-during-cloud-generation',
      question: 'What transcript excerpts are sent to the cloud answer provider?',
      relevantChunkIndexes: [2],
      expectedHit: true,
    },
    {
      id: 'known-lexical-paraphrase-gap',
      question: 'Where does the app keep video subtitles?',
      relevantChunkIndexes: [2],
      expectedHit: false,
    },
  ],
} as const;
