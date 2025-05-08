FROM node:18-alpine

WORKDIR /app

# Install Python3 and pip for AI models
RUN apk add --no-cache python3 py3-pip

# Install AI model dependencies (transformers, torch, soundfile)
RUN pip3 install transformers torch soundfile

# Copy the package files and install Node.js dependencies
COPY package.json ./
RUN npm install

# Copy the entire project including Python scripts and TypeScript workers
COPY . .

# Build the TypeScript files
RUN npm run build

# Set the default command to start the worker
CMD ["node", "dist/index.js"]
