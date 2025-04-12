// backend/routes/generateDescription.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;

  try {
    // 1. Transcribe the file using faster-whisper
    const transcript = await runFasterWhisper(filePath);

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Empty transcript' });
    }

    // 2. Send transcript to Ollama to get a description
    const ollamaRes = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3',
      prompt: `Generate a compelling and informative description for the following video transcript:

${transcript}`,
      stream: false
    });

    const description = ollamaRes.data.response;

    res.json({ description });
  } catch (err) {
    console.error('Error generating description:', err);
    res.status(500).json({ error: 'Failed to generate description' });
  } finally {
    fs.unlink(filePath, () => {}); // Clean up temp file
  }
});

function runFasterWhisper(filePath) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', ['scripts/transcribe.py', filePath]);
    let output = '';

    py.stdout.on('data', (data) => {
      output += data.toString();
    });

    py.stderr.on('data', (data) => {
      console.error('stderr:', data.toString());
    });

    py.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error('Transcription process exited with code ' + code));
      }
    });
  });
}

module.exports = router;
