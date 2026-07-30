FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 nightforge && \
    adduser -u 1001 -G nightforge -s /bin/sh -D nightforge
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER nightforge
EXPOSE 3000
CMD ["node", "dist/main.js"]
