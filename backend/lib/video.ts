import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export async function burnInCaptions(videoPath: string, srtPath: string): Promise<string> {
  const outputPath = videoPath.replace(/\.mp4$/, '-burned.mp4');

  const command = `ffmpeg -y -i "${videoPath}" -vf subtitles="${srtPath}" -c:a copy "${outputPath}"`;
  await execAsync(command);

  return outputPath;
}
