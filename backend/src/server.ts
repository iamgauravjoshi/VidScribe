import express from "express";
import cors from "cors";
import { generateAnswer } from "./services/llm/ollama.service.js";
import { generateEmbedding } from "./services/embeddings/embedding.service.js";
import { pool } from "./db/postgres.js";
import { config } from "./shared/config/index.js";

const app = express();

app.use(cors());
app.use(express.json());

// Health check API
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "YouTube RAG backend is running"
  });
});

// Testing locally configured LLM
app.get("/api/test-llm", async (_req, res) => {
  try {
    const answer = await generateAnswer("Explain RAG in one simple paragraph.");

    res.json({ answer });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to communicate with Ollama"
    });
  }
});

// Testing Embeddings Model
app.get("/api/test-embedding", async (_req, res) => {
  try {
    const embedding = await generateEmbedding(
      "What is retrieval augmented generation?"
    );

    res.json({
      dimensions: embedding.length,
      embedding
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to generate embedding"
    });
  }
});

// Testing PostgreSQL
app.get("/api/test-db", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      connected: true,
      time: result.rows[0].now
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      connected: false
    });
  }
});

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});



