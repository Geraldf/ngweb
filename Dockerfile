FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production \
    PORT=3000 \
    MEDIA_DATA_DIR=/app/data/media \
    WEB_DIST_DIR=/app/apps/web/dist \
    ADMIN_TOKEN=Lennart21
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/data/media/files && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
