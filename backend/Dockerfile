FROM node:18

# Install Python + pip
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    pip3 install --upgrade pip --break-system-packages

# Install faster-whisper
RUN pip3 install faster-whisper --break-system-packages

# Create app directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the backend code
COPY . .

# Expose the backend port
EXPOSE 3001

# Start the backend
CMD ["node", "index.js"]
