# Stage 1: Build with Bun
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source code
COPY . .

# Generate SvelteKit types and build
RUN bunx svelte-kit sync
RUN bun run build

# Stage 2: Production runtime
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built output from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json

# Install production dependencies only
RUN bun install --production --frozen-lockfile 2>/dev/null || bun install --production

# Expose port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start the SvelteKit Node server
CMD ["bun", "build/index.js"]
