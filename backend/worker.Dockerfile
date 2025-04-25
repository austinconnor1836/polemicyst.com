FROM node:18

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy shared code and backend
COPY ../../shared ./shared
COPY . .

# Build the worker
RUN npm run build

CMD ["node", "dist/workers/pollFeeds.js"]
