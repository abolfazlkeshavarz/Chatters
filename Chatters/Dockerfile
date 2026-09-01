# --- Build stage ---
FROM golang:1.24-alpine AS build

# Overridable so a build on a network where proxy.golang.org / sum.golang.org
# are slow or blocked (e.g. some Iranian ISPs) can point at a mirror instead
# — set GOPROXY and GOSUMDB in .env; docker-compose.yml passes them through.
# Left at Go's real defaults otherwise, so a plain "docker compose build"
# with no .env customisation still works exactly as before.
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}

WORKDIR /src

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/chatters-server ./cmd/server

# --- Runtime stage ---
FROM alpine:3.20

RUN apk add --no-cache ca-certificates && \
    adduser -D -H -u 1000 chatters

WORKDIR /app

COPY --from=build /out/chatters-server ./chatters-server

RUN mkdir -p /app/private_uploads && chown -R chatters:chatters /app
USER chatters

ENV UPLOAD_DIR=/app/private_uploads
EXPOSE 8080

ENTRYPOINT ["./chatters-server"]
