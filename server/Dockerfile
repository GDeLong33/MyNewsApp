# Build stage: compile TypeScript.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies and compiled JS only.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/mynews.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Runs as root so it can write to the host-mounted /data directory without permission setup.
EXPOSE 8080
CMD ["node", "dist/index.js"]
