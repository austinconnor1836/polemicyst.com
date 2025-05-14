FROM node:18-slim

# System deps for Python + venv
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    python3 -m venv /venv

# Activate virtualenv and install Python packages
ENV PATH="/venv/bin:$PATH"
RUN pip install --upgrade pip && \
    pip install transformers torch soundfile

# Node setup
WORKDIR /app
COPY package.json ./
RUN npm install

# Copy full project
COPY . .

# Build TypeScript
RUN npm run build

# Start worker
CMD ["node", "dist/index.js"]
