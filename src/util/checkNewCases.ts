// util/checkNewCases.ts

import { Case } from './scrapeCases';

export const checkNewCases = (newCases: Case[], storedCases: Case[]): Case[] => {
  // Filter new cases that do not exist in stored cases
  const newEntries = newCases.filter(
    (newCase) =>
      !storedCases.some(
        (storedCase) =>
          storedCase.number === newCase.number &&
          storedCase.docket === newCase.docket
      )
  );

  return newEntries; // Return new entries
};
