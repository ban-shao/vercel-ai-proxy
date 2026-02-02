FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Create directories
RUN mkdir -p data/keys logs

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
