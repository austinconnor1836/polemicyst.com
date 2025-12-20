import 'dotenv/config';
import { generateClipFromS3 } from './backend/utils/ffmpegUtils';
import path from 'path';

async function main() {
  const localFile = path.resolve('tmp/b4d540fb-b637-4a9b-aebc-3c71f755cbd9.mp4');
  console.log('Testing generateClipFromS3 with local file:', localFile);

  try {
    const result = await generateClipFromS3(
      localFile,
      '00:00:10', // Start at 10s
      '00:00:20', // End at 20s
      'debug-clip-test.mp4'
    );
    console.log('✅ Success:', result);
  } catch (e) {
    console.error('❌ Failed:', e);
  }
}

main();
