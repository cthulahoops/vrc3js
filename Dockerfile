FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM oven/bun:1-slim
WORKDIR /app
COPY server ./server
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production BFF_HOST=0.0.0.0 BFF_PORT=8000 STATIC_DIR=dist
EXPOSE 8000
USER bun
CMD ["bun", "server/index.ts"]
