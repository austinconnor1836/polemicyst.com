// /util/scrapeCases.ts

import axios from 'axios';
import * as cheerio from 'cheerio';

export type Case = {
  number: string;
  date: string;
  docket: string;
  name: string;
  judge: string;
  citation: string;
};

export const scrapeCases = async (): Promise<Case[]> => {
  try {
    const url = 'https://www.supremecourt.gov/opinions/slipopinion/23';
    const { data } = await axios.get(url);

    const $ = cheerio.load(data);
    const cases: Case[] = [];

    $('table tbody tr').each((index, element) => {
      const columns = $(element).find('td');
      const caseNumber = $(columns[0]).text().trim();
      const date = $(columns[1]).text().trim();
      const docket = $(columns[2]).text().trim();
      const name = $(columns[3]).text().trim();
      const judge = $(columns[4]).text().trim();
      const citation = $(columns[5]).text().trim();

      const dateObj = new Date(date);
      const isDateNaN = isNaN(dateObj.getTime());

      if (!isDateNaN && date.length) {
        cases.push({ number: caseNumber, date, docket, name, judge, citation });
      }

    });

    return cases;
  } catch (error) {
    console.error('Error scraping cases:', error);
    return [];
  }
};
