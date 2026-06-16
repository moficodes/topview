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
COPY backend/main.go ./

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./dist

# Compile a static, secure, and optimized Linux binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -v -o server main.go

# ==========================================
# Stage 3: Final Production Runner
# ==========================================
FROM alpine:3.19
WORKDIR /app

# Install security certificates & runtime packages
RUN apk add --no-cache ca-certificates tzdata

# Create local folders for uploaded images
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

# Copy compiled Go server binary from Stage 2
COPY --from=backend-builder /app/backend/server ./server

# Copy compiled static frontend folder
COPY --from=backend-builder /app/backend/dist ./dist

# Standard Cloud Run port setting (Cloud Run automatically injects its own PORT)
ENV PORT=8080
EXPOSE 8080

# Execute server
CMD ["./server"]
