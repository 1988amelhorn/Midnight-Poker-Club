# Back4app Containers: Node WebSocket backend + built SPA.
# Deliberately single process: table engines must share one game host.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=8080
# Free containers have only 256 MB RAM; leave headroom for OS and WebSockets.
ENV NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/dist ./dist
# server.ts imports no build-time secrets; configure all Supabase keys in
# Back4app's deployment environment, NEVER in the Dockerfile or GitHub.
EXPOSE 8080
USER node
CMD ["npm", "start"]
