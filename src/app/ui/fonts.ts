import { Inter, Lusitana } from 'next/font/google';

export const inter = Inter({
    subsets: ['latin', 'greek'],
    variable: "--font-inter",
 });

export const lusitana = Lusitana({ 
    weight: ['400', '700'],
    subsets: ['latin'],
});