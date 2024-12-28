import { Inter, Lusitana, Montserrat } from 'next/font/google';

export const inter = Inter({
    subsets: ['latin', 'greek'],
    variable: "--font-inter",
 });

export const lusitana = Lusitana({ 
    weight: ['400', '700'],
    subsets: ['latin'],
});

export const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  weight: ["400", "700"], // Include different weights if needed
});