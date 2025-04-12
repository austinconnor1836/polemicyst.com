const express = require('express');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../uploads') });

router.post('/', upload.single('file'), (req, res) => {
  const videoPath = req.file.path;

  const pythonProcess = spawn('python3', ['scripts/transcribe.py', videoPath], {
    cwd: path.join(__dirname, '..')
  });

  let transcript = '';
  let error = '';

  pythonProcess.stdout.on('data', (data) => {
    transcript += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    error += data.toString();
  });

  pythonProcess.on('close', (code) => {
    fs.unlink(videoPath, () => {}); // Clean up uploaded file

    if (code !== 0) {
      return res.status(500).json({ error: 'Transcription failed', details: error });
    }

    res.json({ transcript });
  });
});

module.exports = router;
