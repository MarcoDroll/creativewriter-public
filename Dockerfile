# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Build configuration argument (production or development)
ARG BUILD_CONFIGURATION=production

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --prefer-offline --no-audit

# Copy source code (separate layer for better caching)
COPY src/ ./src/
COPY angular.json tsconfig*.json ./
COPY public/ ./public/

# Cache-busting argument - ensures build always runs fresh when commit changes
# This is necessary because Angular generates unique chunk hashes per build
ARG CACHE_BUST=unknown

# Build the application with specified configuration
RUN echo "Build cache bust: ${CACHE_BUST}" && npm run build -- --configuration=${BUILD_CONFIGURATION}

# Production stage
FROM nginx:alpine

# Copy built application from build stage (Angular 20 outputs to browser/ subdirectory)
COPY --from=build /app/dist/creativewriter2/browser /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]