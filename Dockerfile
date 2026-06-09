FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV LUMIO_PORT=3000
ENV LUMIO_STATIC_DIR=/app/dist
ENV LUMIO_CONFIG_DIR=/app/config

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package*.json ./

EXPOSE 3000

CMD ["node", "server/lumio-server.mjs"]
