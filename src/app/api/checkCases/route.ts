// src/app/api/checkCases/route.ts

import { NextResponse } from 'next/server';
import fs from 'fs/promises'; // Use fs/promises for async operations
import path from 'path';
import { scrapeCases, Case } from '../../../util/scrapeCases';
import { checkNewCases } from '../../../util/checkNewCases';

// Define the path to the JSON file
const filePath = path.join(process.cwd(), 'data', 'cases.json');

// Load stored cases from the file
const loadStoredCases = async (): Promise<Case[]> => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // If file not found, return an empty array
      return [];
    }
    throw error; // Rethrow if other error
  }
};

// Save new cases to the file
const saveNewCases = async (cases: Case[]) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(cases, null, 2), 'utf-8');
};

export async function GET() {
  try {
    const scrapedCases = await scrapeCases();
    const storedCases = await loadStoredCases();

    // Check for new cases
    const newCases = checkNewCases(scrapedCases, storedCases);

    // Save updated cases if there are new entries
    if (newCases.length > 0) {
      await saveNewCases(scrapedCases);
    }

    return NextResponse.json({ newCases, storedCases });
  } catch (error) {
    console.error('Error in API route:', error);
    return NextResponse.json({ error: 'Failed to check cases' }, { status: 500 });
  }
}
