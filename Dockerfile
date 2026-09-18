# ==========================================
# Stage 1: Build the React TypeScript Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source files
COPY frontend/ ./

# Compile and build the static frontend assets
RUN npm run build

# ==========================================
# Stage 2: Build the Go Backend
# ==========================================
FROM golang:1.22-alpine AS backend-builder
WORKDIR /app/backend

# Install build dependencies
RUN apk add --no-cache git

# Download Go dependencies
COPY backend/go.* ./
RUN go mod download

# Copy backend source files
COPY backend/ ./

# Compile a static, secure, and optimized Linux binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -v -o server .

# ==========================================
# Stage 3: Final Production Runner
# ==========================================
FROM alpine:3.19
WORKDIR /app

# Install security certificates & runtime packages
RUN apk add --no-cache ca-certificates tzdata

# Create an unprivileged non-root user and group with numeric UID/GID for strict container security
RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup

# Create local folders for uploaded images with restrictive permissions
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads && chmod 750 /app/uploads

# Copy compiled Go server binary and static assets (read-only for appuser)
COPY --from=backend-builder /app/backend/server ./server
COPY --from=frontend-builder /app/frontend/dist ./dist

# Switch to unprivileged user
USER 10001:10001

# Standard Cloud Run port setting (Cloud Run automatically injects its own PORT)
ENV PORT=8080
EXPOSE 8080

# Execute server
CMD ["./server"]
