# --- Build stage ---
FROM node:20-alpine AS build

# Overridable so a build on a network where registry.npmjs.org is slow or
# blocked (e.g. some Iranian ISPs) can point at a mirror instead — set
# NPM_REGISTRY in .env; docker-compose.yml passes it through. Left at npm's
# real default otherwise, so a plain "docker compose build" with no .env
# customisation still works exactly as before.
ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm install --no-audit --no-fund

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
