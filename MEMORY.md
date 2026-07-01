# MEMORY.md - Long-Term Project Context & Knowledge Base

## 1. Project Overview
- **Name:** cybraferibot (Bot name: Dianyssa / CybraFeriBot)
- **Description:** An advanced AI Telegram bot with document processing capabilities (PDF, DOCX, XLSX), RAG (Qdrant), and rich interactive features.

## 2. Tech Stack & Architecture
- **Runtime & Package Manager:** Bun (`bun run dev`, `bun test`, etc.)
- **Language:** TypeScript
- **Telegram Framework:** grammY (`bot/index.ts`)
- **API Framework:** Hono (`api/`)
- **ORM:** Drizzle ORM (`db/`)
- **Database:** SQLite (local development with `sqlite.db`) / MariaDB (Production/Docker setup)
- **Vector DB:** Qdrant (for RAG capabilities)
- **AI Providers:** Gemini (Native `@google/genai`), OpenAI compatible models.
- **Architecture:** Modular Monolith. 
  - `bot/` for Telegram specific logic.
  - `api/` for Hono web server.
  - `lib/` for shared business logic, NLP, AI integrations, etc.
  - `db/` for schemas and migrations.

## 3. Project Constraints & Conventions
- **Telegram Rich Messages:** Telegram has strict HTML/Markdown parsing. Always use safe reply methods (e.g., `replySafely`, `replySafelyMarkdown`) with graceful fallbacks for parsing errors.
- **Document Processing:** Handled via local temporary downloads (`/tmp/cybrabot-documents`), using libraries like `pdf-lib`, `mammoth`, `xlsx`. Mind the memory and file size limits (max 20MB by default).
- **Environment:** Development uses polling (`bot.start()`), Production uses Webhooks via Hono.
- **Styling/Frontend (if applicable):** Use TailwindCSS, ensure responsive and premium aesthetics. 

## 4. Past Lessons & Known Issues (Troubleshooting History)
- **CI/CD Builds:** Beware of missing UI components (e.g., Lucide-React icons like `Send`) causing `tsc` or Docker build failures during GHCR deployment.
- **Document Export UX:** When generating documents, use animated indicators (`startAnimatedProcessingMessage`) to keep the user engaged, and ensure they are cleaned up after delivery.
- **Database Connectivity:** When moving to Docker/MariaDB, ensure privileges (`ER_BAD_DB_ERROR`) and syntax compatibility are checked, as local uses SQLite.
- **Qdrant Integration:** Ensure robust fallback if vector storage/retrieval fails or Unicode characters (emojis/dashes) break downstream processing (like PDF generation).
