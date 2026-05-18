# Stage 1: Build with Bun
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate SvelteKit types and build
RUN bunx svelte-kit sync
RUN bun run build

# Stage 2: Production runtime
FROM oven/bun:1-alpine

WORKDIR /app

# curl needed for health check
RUN apk add --no-cache curl

# Copy built output and lockfile from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json /app/bun.lockb ./

# Install production dependencies only — lockfile ensures reproducible install
RUN bun install --production --frozen-lockfile

# Expose port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start the SvelteKit Node server
CMD ["bun", "build/index.js"]
