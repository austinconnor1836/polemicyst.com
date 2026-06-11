import React from 'react';

const DMCA: React.FC = () => {
  const mailtoSubject = encodeURIComponent('DMCA Takedown Notice');
  const mailtoBody = encodeURIComponent(
    [
      'DMCA Takedown Notice',
      '',
      '1. Your contact information (full legal name, mailing address, phone, email):',
      '',
      '2. Description of the copyrighted work you claim has been infringed:',
      '',
      '3. URL(s) on Clipfire where the allegedly infringing material is located:',
      '',
      '4. Statement: "I have a good-faith belief that use of the material in the manner',
      '   complained of is not authorized by the copyright owner, its agent, or the law."',
      '',
      '5. Statement: "I swear, under penalty of perjury, that the information in this notice',
      '   is accurate and that I am the copyright owner or am authorized to act on behalf of',
      '   the owner of an exclusive right that is allegedly infringed."',
      '',
      '6. Physical or electronic signature (type your full legal name):',
      '',
    ].join('\n')
  );
  const mailtoHref = `mailto:dmca@clipfire.app?subject=${mailtoSubject}&body=${mailtoBody}`;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        DMCA Takedown Notice
      </h1>
      <p className="text-gray-700 dark:text-gray-300 mb-4">
        <strong>Last Updated: June 11, 2026</strong>
      </p>

      <section className="mb-6">
        <p className="text-gray-700 dark:text-gray-300">
          Clipfire respects the intellectual-property rights of others and responds to clear notices
          of alleged copyright infringement under the U.S. Digital Millennium Copyright Act (DMCA).
          If you are a rights-holder (or authorized to act on behalf of one) and believe content on
          Clipfire infringes your copyright, please send a takedown notice using the form below.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          What to include in your notice
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          To comply with 17 U.S.C. § 512(c)(3), your notice must include:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 space-y-1">
          <li>Your full legal name and contact information (address, phone, email).</li>
          <li>
            A description of the copyrighted work you claim has been infringed (and a reference URL
            to the original, if available).
          </li>
          <li>The Clipfire URL(s) of the allegedly infringing material.</li>
          <li>
            A statement that you have a good-faith belief that the use is not authorized by the
            copyright owner, its agent, or the law.
          </li>
          <li>
            A statement, under penalty of perjury, that the information in your notice is accurate
            and that you are the copyright owner or authorized to act on its behalf.
          </li>
          <li>
            Your physical or electronic signature (typing your full legal name is sufficient).
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Submit your notice
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          Fill out the fields below for your own records, then click <strong>Send via Email</strong>{' '}
          to open your mail client with the notice pre-filled. Send to{' '}
          <a href="mailto:dmca@clipfire.app" className="text-blue-500 hover:underline">
            dmca@clipfire.app
          </a>
          .
        </p>

        <form action={mailtoHref} method="post" encType="text/plain" className="space-y-4">
          <div>
            <label
              htmlFor="contact"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1"
            >
              Contact information (full legal name, mailing address, phone, email)
            </label>
            <textarea
              id="contact"
              name="contact"
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label
              htmlFor="work"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1"
            >
              Description of the copyrighted work
            </label>
            <textarea
              id="work"
              name="work"
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label
              htmlFor="infringingUrl"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1"
            >
              URL(s) of the infringing material on Clipfire
            </label>
            <textarea
              id="infringingUrl"
              name="infringingUrl"
              rows={2}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div className="flex items-start gap-2">
            <input type="checkbox" id="goodFaith" name="goodFaith" className="mt-1" required />
            <label htmlFor="goodFaith" className="text-sm text-gray-700 dark:text-gray-300">
              I have a good-faith belief that use of the material in the manner complained of is not
              authorized by the copyright owner, its agent, or the law.
            </label>
          </div>

          <div className="flex items-start gap-2">
            <input type="checkbox" id="perjury" name="perjury" className="mt-1" required />
            <label htmlFor="perjury" className="text-sm text-gray-700 dark:text-gray-300">
              I swear, under penalty of perjury, that the information in this notice is accurate and
              that I am the copyright owner or am authorized to act on behalf of the owner of an
              exclusive right that is allegedly infringed.
            </label>
          </div>

          <div>
            <label
              htmlFor="signature"
              className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1"
            >
              Signature (type your full legal name)
            </label>
            <input
              type="text"
              id="signature"
              name="signature"
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <a
              href={mailtoHref}
              className="inline-block rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700"
            >
              Send via Email
            </a>
          </div>
        </form>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Counter-notice
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          If you believe your content was removed in error, you may submit a counter-notice to{' '}
          <a href="mailto:dmca@clipfire.app" className="text-blue-500 hover:underline">
            dmca@clipfire.app
          </a>
          . Your counter-notice must include your contact information, identification of the removed
          material and its prior location, a statement under penalty of perjury that you have a
          good-faith belief the material was removed by mistake or misidentification, your consent
          to the jurisdiction of the federal district court in your district (or the Northern
          District of California if you reside outside the U.S.), and your signature. We will
          forward valid counter-notices to the original complainant and may restore the content if
          no court action is filed within the statutory window.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Repeat-infringer policy
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We terminate the accounts of users who are determined to be repeat infringers.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Contact</h2>
        <p className="text-gray-700 dark:text-gray-300">
          DMCA contact:{' '}
          <a href="mailto:dmca@clipfire.app" className="text-blue-500 hover:underline">
            dmca@clipfire.app
          </a>
        </p>
      </section>
    </div>
  );
};

export default DMCA;
