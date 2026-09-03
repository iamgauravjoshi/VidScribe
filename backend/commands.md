# What we are going to build?
Our final application will be:

                    ┌──────────────────────────┐
                    │       React UI           │
                    │                          │
                    │      YouTube URL         │
                    │ [____________________]   │
                    │ [ Process Video ]        │
                    │ ──────────────────────── │
                    │ Chat                     │
                    │ User: What is RAG?       │
                    │ AI: RAG is...            │
                    │ User: Why embeddings?    │
                    │ AI: Embeddings are...    │
                    └────────────┬─────────────┘
                                 │ HTTP
                                 ▼
                    ┌─────────────────────────┐
                    │    Node + Express       │
                    └────────────┬────────────┘
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
       │  YouTube    │   │ PostgreSQL   │   │   Ollama    │
       │ Transcript  │   │ + pgvector   │   │    LLM      │
       └─────────────┘   └──────────────┘   │ Embeddings  │
                                            └─────────────┘


We'll use:
- Frontend: React + TypeScript + SCSS
- Backend: Node.js + Express + TypeScript
- LLM: Ollama locally
- Embedding model: Ollama locally
- Database: PostgreSQL
- Vector search: pgvector
- YouTube: transcript extraction
- Docker: PostgreSQL/pgvector initially
- No LangChain initially — we will implement the RAG pipeline ourselves.


### Understand the two pipelines first
This is the single most important architectural concept.

### Pipeline A — Ingestion (Video Processing Pipeline)
When the user enters:
> https://www.youtube.com/watch?v=ABC123

```mermaid
flowchart LR
    A[YouTube URL] --> B[Extract video ID]
    B --> C[Get transcript]
    C --> D[Clean transcript]
    D --> E[Split into chunks]
    E --> F[Generate embeddings]
    F --> G[Store chunks + embeddings]
```
This pipeline runs **once per video**.


### Pipeline B — Question answering
When the user asks:
> Why does the speaker use vector databases?

```mermaid
flowchart LR
    A[Question] --> B[Generate question embedding]
    B --> C[Search vector database]
    C --> D[Get relevant chunks]
    D --> E[Build prompt]
    E --> F[Send prompt + context to LLM]
    F --> G[Answer]
```
This happens **every time the user asks a question**.


## Prerequisites
1. Node.js  
`node --version`  
`npm --version`

2. Docker  
`docker --version`  
`docker compose version`

3. Ollama  
`npm i ollama`  
`ollama --version`  
`ollama list`

4. Install an LLM  
`ollama pull qwen3:4b`  
`ollama run qwen3:4b`

5. Install an embedding model  
`ollama pull nomic-embed-text` 

Notice the distinction:
```
qwen3:4b → GENERATES ANSWERS
nomic-embed-text → GENERATES VECTORS
```

### Create Docker container using docker-compose.yml
Inside docker-compose.yml file, we configured:
```
environment:
  POSTGRES_DB: vidscribe_rag
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: postgres
```

This means docker will create a PostgreSQL database called: **vidscribe_rag**


### Create database schema
---
Create the tables, columns, relationships, indexes, and pgvector configuration that our application needs. Eventually we'll have:

```
PostgreSQL Server
│
└── vidscribe_rag      ← Database
    │
    ├── videos
    ├── video_chunks
    ├── conversations
    └── messages
```

Where should you create these tables


### Create tables inside database (hosted on docker)
---
Since we're running PostgreSQL inside Docker, you have several options.
- pgAdmin: we can visually see everything
- psql


### Option A - Using pgAdmin 

- **Step 01:** Connect pgAdmin to your PostgreSQL container. Your connection details are:
```
Host: localhost
Port: 5432
Username: your_username
Password: your_password
Database: your_database_name
```

Once connected, you'll see something like:
```
Servers
└── PostgreSQL
    └── Databases
        └── (your_database_name)
            └── Schemas
                └── public
                    ├── Tables
                    ├── Views
                    └── ...
```

- **Step 02:** 
In pgAdmin Open Query Tool and execute  
`CREATE EXTENSION IF NOT EXISTS vector;`

> **CREATE EXTENSION vector;**  
It doesn't install pgvector. It only enables an extension that must already exist on the PostgreSQL server.

> **Why are we creating the vector extension?**  
Answer: Normally PostgreSQL doesn't understand this: 
[0.12, -0.45, 0.78, ...]
pgvector adds support for storing and searching vectors. Basically this command tells PostgreSQL:
Enable pgvector functionality in this database.

- Step 03: Now create the **videos** table
```
CREATE TABLE videos (
    id SERIAL PRIMARY KEY,
    youtube_video_id VARCHAR(20) NOT NULL UNIQUE,
    url TEXT NOT NULL,
    title TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- Step 04: Now create **video_chunks**  
One YouTube video can have many chunks. So, this is a **one-to-many relationship**.

```
CREATE TABLE video_chunks (
    id SERIAL PRIMARY KEY,
    video_id INTEGER NOT NULL
        REFERENCES videos(id)
        ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_time_seconds REAL,
    end_time_seconds REAL,
    embedding VECTOR(768),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

NOTE:
> **ON DELETE CASCADE** means We don't want its chunks to remain in the database. It means,  
`Delete video → Automatically delete its chunks`

> **start_time_seconds REAL** AND **end_time_seconds REAL**
These store where the chunk occurs in the YouTube video.

> **embedding VECTOR(768)** is where we store the embedding generated by our embedding model. Because the embedding model we're using produces a vector with a specific number of dimensions. (Different embedding models can produce different dimensions)


### Database Migrations
---
In a real project we don't manually open pgAdmin and created the tables, instead we use database migrations. For example: 
```
migrations/
│
├── 001_enable_pgvector.sql
├── 002_create_videos.sql
├── 003_create_video_chunks.sql
├── 004_create_conversations.sql
└── 005_create_messages.sql
```

Then a new developer can clone the project and and get the entire database by running: `npm run db:migrate`


### Option B - Using psql
You can also create everything directly from your Docker container. Run below command

<!-- Enable docker container -->
`docker exec -it vidscribe-postgres psql -U postgres -d vidscribe_rag`

Now you'll enter PostgreSQL, and run all the same commands that we did in pgAdmin


## We using characters rather than tokens
A production-grade chunker would ideally understand tokens.
But initially: 3000 characters
is much easier to understand than: ~700 tokens

Once the system works, we'll improve it.


# RAG ingestion pipeline

```mermaid
flowchart LR
    A[YouTube URL] --> B[Transcript]
    B --> C[Chunks]
    C --> D[Embedding model]
    D --> E[Vectors]
    E --> F[PostgreSQL]
```
That's the first half of your RAG application.
Later we'll optimize ingestion with batching/concurrency.

## Actual RAG Query

```mermaid
flowchart LR
    A[Question] --> B[Embedding]
    B --> C[Vector Search]
    C --> D[Relevant transcript]
    D --> E[Prompt]
    E --> F[LLM]
    F --> G[Answer]
```


## The LLM isn't directly querying PostgreSQL.
It knows nothing about:
PostgreSQL, pgvector, chunks, embeddings

It simply receives:
instructions + retrieved context + question

This is why the architecture is:
```
Application
   │
   ├── Retrieval
   │
   └── LLM generation
```

### Context related problem
The retrieval system process one thing at a time. And further query related to previous input feels ambiguous. The embedding search doesn't necessarily know that.
This is where **conversation history** becomes important.


### Add conversation history
```
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    video_id INTEGER NOT NULL
        REFERENCES videos(id)
        ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL
        REFERENCES conversations(id)
        ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Query Rewriting/Contextual Query Rewriting  



## Now think like an engineer
Your application has several failure points.
For example: 
```
YouTube URL
    │
    ├── invalid URL
    │
    ├── video unavailable
    │
    ├── transcript unavailable
    │
    ├── YouTube request blocked
    │
    ▼
Transcript
    │
    ├── empty transcript
    │
    ▼
Chunking
    │
    ▼
Embedding
    │
    ├── Ollama unavailable
    │
    ▼
PostgreSQL
    │
    ├── DB unavailable
    │
    ▼
Retrieval
    │
    ├── no relevant chunks
    │
    ▼
   LLM
    │
    ├── Ollama unavailable
    │
    ▼
  Answer
```
A production application needs to handle every one of these.


## The complete architecture after all this
```
┌────────────────────────────────────────────────────────────┐
│                         REACT                              │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ YouTube URL                                          │  │
│  │ [ https://youtube.com/watch?v=... ] [Process]        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                       Chat                           │  │
│  │                                                      │  │
│  │ You: What is RAG?                                    │  │
│  │                                                      │  │
│  │ AI: RAG is...                                        │  │
│  │                                                      │  │
│  │ Sources: 02:14, 03:01                                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│                     EXPRESS API                            │
│                                                            │
│                 POST /videos/process                       │
│                 POST /videos/:id/chat                      │
└─────────────┬──────────────────────────────┬───────────────┘
              │                              │
              ▼                              ▼
┌──────────────────────┐          ┌─────────────────────────┐
│ INGESTION PIPELINE   │          │ QUERY PIPELINE          │
│                      │          │                         │
│ YouTube URL          │          │ User question           │
│      ↓               │          │      ↓                  │
│ Transcript           │          │ Query embedding         │
│      ↓               │          │      ↓                  │
│ Chunking             │          │ Vector search           │
│      ↓               │          │      ↓                  │
│ Embeddings           │          │ Relevant chunks         │
│      ↓               │          │      ↓                  │
│ PostgreSQL           │          │ RAG prompt              │
│                      │          │      ↓                  │
└──────────┬───────────┘          │ Ollama                  │
           │                      │      ↓                  │
           │                      │ Answer                  │
           │                      └──────────┬──────────────┘
           │                                 │
           ▼                                 ▼
┌────────────────────────────────────────────────────────────┐
│                 POSTGRESQL + PGVECTOR                      │
│                                                            │
│ videos                                                     │
│ video_chunks                                               │
│ conversations                                              │
│ messages                                                   │
│                                                            │
│ embeddings                                                 │
└────────────────────────────────────────────────────────────┘
                             │
                             │
                             ▼
                    ┌─────────────────┐
                    │     OLLAMA      │
                    │                 │
                    │      Qwen       │
                    │ Embedding model │
                    └─────────────────┘
```


# What you should learn from each stage
After each stage, you should be able to explain:

- Stage 1

What is an LLM?
> Prompt → LLM → Generated text

- Stage 2

What is an embedding?
> Text → numerical vector

- Stage 3

Why do we need embeddings?  
Because we want semantic similarity.

- Stage 4

Why pgvector?
Because we need to efficiently search vectors.

- Stage 5

Why chunk documents?  
Because we don't want to retrieve or send an entire video transcript for every question.

- Stage 6

What is retrieval?  
Finding the most relevant chunks for a question.

- Stage 7

What is augmentation?  
Adding retrieved information to the LLM prompt.

- Stage 8

What is generation?  
The LLM generates the final response using the question + retrieved context.


## The implementation order I want you to follow
Build and verify these checkpoints:
```
CHECKPOINT 1
────────────
Ollama works
    ↓
"Explain RAG"
    ↓
Answer


CHECKPOINT 2
────────────
Embedding works
    ↓
text → vector


CHECKPOINT 3
────────────
PostgreSQL + pgvector
    ↓
vector stored successfully


CHECKPOINT 4
────────────
Semantic search
    ↓
question → relevant chunks


CHECKPOINT 5
────────────
Basic RAG
    ↓
question → search → LLM → answer


CHECKPOINT 6
────────────
YouTube ingestion
    ↓
URL → transcript → chunks → embeddings


CHECKPOINT 7
────────────
React
    ↓
URL → process → chat


CHECKPOINT 8
────────────
Conversation memory
    ↓
multi-turn chat


CHECKPOINT 9
────────────
Citations
    ↓
answer → video timestamps


CHECKPOINT 10
─────────────
Production improvements
    ↓
streaming
queues
reranking
query rewriting
evaluation
```

## ggggggggg

<!-- -------------------------------------------- -->

Questions -
- Explain 25. Now implement semantic search
- Explain 26. Implement vector search
- Explain 28. Build chunking
- Why are we using characters rather than tokens?

30. Understand chunking with a real example
<!-- -------------------------------------------- -->


