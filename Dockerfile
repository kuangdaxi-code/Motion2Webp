FROM node:20-slim

# Install ffmpeg (needed for webp encoding)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy app
COPY . .

# Runtime env
ENV NODE_ENV=production
ENV PORT=5173
EXPOSE 5173

CMD ["node", "server.js"]
