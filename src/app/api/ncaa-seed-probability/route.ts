import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function GET() {
  const scriptPath = path.join(process.cwd(), 'scripts', 'ncaa_seed_probability.py');

  return new Promise<NextResponse>((resolve) => {
    exec(`python3 "${scriptPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Python script error:', stderr);
        resolve(
          NextResponse.json({ error: 'Failed to compute seed probability data' }, { status: 500 })
        );
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolve(NextResponse.json(data));
      } catch {
        console.error('JSON parse error:', stdout);
        resolve(NextResponse.json({ error: 'Invalid data from Python script' }, { status: 500 }));
      }
    });
  });
}
