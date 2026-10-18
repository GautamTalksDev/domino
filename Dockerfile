# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DOMINO_STANDALONE=true
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Run as an unprivileged user.
RUN addgroup -S domino && adduser -S domino -G domino
COPY --from=build --chown=domino:domino /app/.next/standalone ./
COPY --from=build --chown=domino:domino /app/.next/static ./.next/static
COPY --from=build --chown=domino:domino /app/public ./public
USER domino
EXPOSE 3000
CMD ["node", "server.js"]
