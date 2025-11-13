#!/bin/bash

# Ensure this script is executable (only matters if it's rerun or exec'd elsewhere)
chmod +x "$0"

# Start Ollama in the background
ollama serve &

# Wait for Ollama to be ready
until curl -s http://localhost:11434 > /dev/null; do
  echo "🕐 Waiting for Ollama to start..."
  sleep 1
done

# Pull model (e.g., llama3)
echo "⬇️  Pulling model: llama3"
ollama pull llama3

# Keep container alive
wait
