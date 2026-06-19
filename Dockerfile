FROM oven/bun:1.3.13 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY api ./api
COPY bot ./bot
COPY db ./db
COPY knowledge ./knowledge
COPY lib ./lib
COPY skills ./skills
COPY drizzle.config.ts ./
COPY index.ts ./
COPY tsconfig.json ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=4129
ENV DATABASE_URL=/app/data/sqlite.db

EXPOSE 4129

CMD ["sh", "-lc", "bun run db:init && bun run start"]
