FROM oven/bun:1.3.13 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY api ./api
COPY bot ./bot
COPY db ./db
COPY lib ./lib
COPY drizzle.config.ts ./
COPY index.ts ./
COPY tsconfig.json ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=4129
ENV DATABASE_URL=/app/data/sqlite.db

EXPOSE 4129

CMD ["bun", "run", "start"]
