import express from 'express';
import cors from 'cors';
import { generateAnswer } from './services/llm/ollama.service.js';
import { generateEmbedding } from './services/embeddings/embedding.service.js';
import { pool } from './db/postgres.js';
import { config } from './shared/config/index.js';
import { ingestVideo } from './services/ingestion/ingestion.service.js';
import { answerQuestion } from './services/rag/rag.service.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { validate } from './middleware/validation.middleware.js';
import { validateProcessVideoRequest } from './validators/video.validator.js';
import { validateChatRequest, validateVideoIdParam } from './validators/chat.validator.js';

const app = express();

app.use(cors());
app.use(express.json());

// Health check API
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'YouTube RAG backend is running',
  });
});

// Testing Embeddings Model
app.get('/api/test-embedding', async (_req, res) => {
  try {
    const embedding = await generateEmbedding('What is retrieval augmented generation?');

    res.json({
      dimensions: embedding.length,
      embedding,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: 'Failed to generate embedding',
    });
  }
});

// Testing PostgreSQL
app.get('/api/test-db', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');

    res.json({
      connected: true,
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      connected: false,
    });
  }
});

// process-video endpoint
app.post('/api/videos/process', validate(validateProcessVideoRequest), async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        message: 'YouTube URL is required',
      });
    }

    const result = await ingestVideo(url);

    res.json(result);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: '🚨 Transcript is disabled on this video',
    });
  }
});

// Chat endpoint
app.post(
  '/api/videos/:videoId/chat',
  validate(validateVideoIdParam),
  validate(validateChatRequest),
  async (req, res) => {
    try {
      const videoId = Number(req.params.videoId);
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({
          message: 'Question is required',
        });
      }

      if (Number.isNaN(videoId)) {
        return res.status(400).json({
          message: 'Invalid videoId',
        });
      }

      // Check PostgreSQL first
      const videoIdResult = await pool.query('SELECT id FROM videos WHERE id = $1', [videoId]);

      if (videoIdResult.rows.length === 0) {
        return res.status(404).json({
          message: 'Video not found',
        });
      }

      // Video exists → now do RAG / LLM
      const result = await answerQuestion(videoId, question);

      res.json(result);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: 'Failed to answer question',
      });
    }
  },
);

// Global error middleware should be registered after your routes.
app.use(errorMiddleware);

app.listen(config.server.port, () => {
  console.log(`Backend running on http://localhost:${config.server.port}`);
});
