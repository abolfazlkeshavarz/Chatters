# --- Build stage ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY public ./public
COPY src ./src
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Shared location rules, included by the HTTP block above and by the TLS block
# that docker-compose.https.yml mounts over it for local HTTPS testing.
COPY app-locations.conf /etc/nginx/app-locations.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80 443
