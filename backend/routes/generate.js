const express = require('express');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const fetch = require('node-fetch');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../uploads') });

router.post('/', upload.single('file'), async (req, res) => {
  const videoPath = req.file.path;

  const pythonProcess = spawn('python3', ['scripts/transcribe.py', videoPath], {
    cwd: path.join(__dirname, '..'),
  });

  let transcript = '';
  let error = '';

  pythonProcess.stdout.on('data', (data) => {
    transcript += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    error += data.toString();
  });

  pythonProcess.on('close', async (code) => {
    fs.unlink(videoPath, () => {}); // clean up uploaded file

    if (code !== 0) {
      return res.status(500).json({ error: 'Transcription failed', details: error });
    }

    try {
      const ollamaRes = await fetch('http://ollama:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          prompt: `Write a compelling YouTube-style description and title for the following transcript:\n\n"${transcript}"\n\nReturn a JSON object like: {"description": "...", "title": "...", "hashtags": ["..."]}`,
          stream: true,
        }),
      });

      let raw = '';
      for await (const chunk of ollamaRes.body) {
        raw += chunk.toString();
      }

      // Combine streamed JSON lines
      let combined = '';
      raw.split('\n').forEach((line) => {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            combined += parsed.response || '';
          } catch (e) {
            console.warn('Skipping line parse error:', e.message);
          }
        }
      });

      const jsonStart = combined.indexOf('{');
      const jsonEnd = combined.lastIndexOf('}');
      const jsonString = combined.slice(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonString);

      return res.json(parsed);
    } catch (err) {
      console.error('Ollama generation error:', err);
      return res.status(500).json({ error: 'Failed to generate description', details: err.message });
    }
  });
});

module.exports = router;
