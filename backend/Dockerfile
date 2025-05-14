FROM node:18

# Install Python + pip
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    pip3 install --upgrade pip --break-system-packages

# Install faster-whisper
RUN pip3 install faster-whisper --break-system-packages

# Set workdir and copy backend files
WORKDIR /app

# Copy backend package files and install deps
COPY ./backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install

# Copy full context after installing deps
WORKDIR /app
COPY . .

# Generate Prisma client (output goes to backend/node_modules/.prisma)
WORKDIR /app/backend
RUN npx prisma generate --schema=../prisma/schema.prisma

# Build backend TypeScript
RUN npm run build

EXPOSE 3001
CMD ["node", "index.js"]
# CMD ["sh"]