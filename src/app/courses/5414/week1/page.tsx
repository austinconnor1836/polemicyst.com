 'use client'
 import Image from 'next/image';

export default function Home() {
  return (
    <div>
      <h1>5414</h1>
      <Image
        src="/images/image.png"
        alt="Example Image"
        width={500}
        height={300}
      />
      <h2>What are Divide and Conquer Algorithms?</h2>
      {/* Video: What are Divide and Conquer Algorithms? */}
      <h3>Reading:</h3>
      <p>CLRS Chapter 4. Please read the introductory part of chapter 4 of Cormen, Leiserson, Rivest and Stein up to Chapter 4.1</p>
      <h2>Max Subarray Problem Using Divide and Conquer</h2>
      <h3>Reading:</h3>
      <p>CLRS Chapter 4.1 Please read chapter 4.1 of CLRS</p>
      <h2>Karatsuba’s Multiplication Algorithm</h2>
      <h3>Reading:</h3>
      <p>Jupyter notebook</p>
      <h2>Master Method Revisited</h2>
      <h3>Reading:</h3>
      <p>CLRS Chapters 4.3 - 4.5
        Chapter 4.3 talks about the substitution method for solving recurrences. It is very instructive to read this chapter. We have covered this method in our lectures should be familiar. It would also be great to revise concepts around arithmetic, geometric and arithmetic-geometric series summations.

        Khan academy is a great resource: 
        https://www.khanacademy.org/math/precalculus/x9e81a4f98389efdf:series


        Chapter 4.4 uses recursion trees which is a visual device for keeping track of the terms in the summation expansions we get for recurrences. 

        The main portion of master method is covered in chapter 4.5.

        For those interested in a detailed proof, please read chapter 4.6.
      </p>
      <h2>Fast Fourier Transform Algorithm</h2>
      <h3>Reading:</h3>
      <p>
        Basics of Complex Numbers
        Khan Academy has a series of videos on complex numbers that provide the kind of fundamentals we have been unable to provide here: 

        https://www.khanacademy.org/math/precalculus/x9e81a4f98389efdf:complex


        Most pre-calculus level math textbooks should do a great job of covering the basics of complex numbers. Please focus on 

        - Understanding complex numbers

        - Complex conjugates

        - Modulus and Phase (angle) of a complex number

        - Operations on Complex numbers

        - DeMoivre's Theorem

        - Complex Roots of Unity
      </p>
      <h3>Reading:</h3>
      <p>
        Fourier Transforms
        Although Fourier transforms are outside the scope of this class, they are quite helpful in data analysis.

        Here is a nice visual explanation courtesy of 3blue1brown: 
        https://youtu.be/spUNpyF58BY
      </p>
      <h3>Reading:</h3>
      <p>
        Fast Fourier Transform
        CLRS Chapter 30 up to section 30.2. 

        Section 30.3 is an interesting read if you are further interested in this topic.

        We have code and interesting examples of using FFT for data analysis in the google notebook that can be opened using Google collab.

        https://drive.google.com/file/d/17pGZNemo_0mwd25Iuryponl3yQ1tHqCP/view?usp=share_link
      </p>
      <h2>Problem Set</h2>
    </div>
  );
}
