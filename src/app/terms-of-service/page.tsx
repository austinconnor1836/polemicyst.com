import React from 'react';

const TermsOfService: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Terms of Service for Clipfire
      </h1>
      <p className="text-gray-700 dark:text-gray-300 mb-4">
        <strong>Last Updated: June 11, 2026</strong>
      </p>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          1. Acceptance of Terms
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          By accessing and using Clipfire, you agree to comply with these Terms of Service. If you
          do not agree, please do not use our website, mobile apps, or services.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          2. Use of the Service
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Clipfire provides AI-powered viral clip generation from long-form video content. You agree
          to use the platform for lawful purposes only. Misuse of the platform, including spamming,
          harassment, copyright infringement, or unlawful activity, is strictly prohibited.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          3. User Accounts
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          You may be required to create an account to access certain features. You are responsible
          for maintaining the security of your account credentials. You must not share your account
          with others or allow unauthorized access.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          4. Content Ownership
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Users retain ownership of any content they submit, including videos and generated clips.
          By using Clipfire, you grant us a limited license to process your content as necessary to
          provide the clip generation service. You are responsible for ensuring you have the rights
          to any content you upload or connect.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          5. Subscriptions and Billing
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Certain features require a paid subscription. Subscription terms, pricing, and billing
          cycles are presented at the time of purchase. You may cancel your subscription at any time
          through your account settings.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          6. Termination
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We reserve the right to terminate or suspend access to our services at our discretion if
          we believe you have violated these terms.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          7. Copyright and DMCA
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          Clipfire respects intellectual-property rights and complies with the Digital Millennium
          Copyright Act (DMCA). If you believe content on Clipfire infringes your copyright, you may
          submit a takedown notice via our{' '}
          <a href="/legal/dmca" className="text-blue-500 hover:underline">
            DMCA notice page
          </a>{' '}
          or by emailing{' '}
          <a href="mailto:dmca@clipfire.app" className="text-blue-500 hover:underline">
            dmca@clipfire.app
          </a>
          . Your notice must include the information required by 17 U.S.C. § 512(c)(3).
        </p>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          If you believe your content was removed in error, you may submit a counter-notice using
          the same contact channels. We will forward valid counter-notices to the original
          complainant and may restore the content if no court action is filed within the statutory
          window.
        </p>
        <p className="text-gray-700 dark:text-gray-300">
          We terminate accounts of users who are determined to be repeat infringers.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          8. Changes to These Terms
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We may update these Terms of Service from time to time. Users will be notified of
          significant changes via email or in-app notification.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          9. Contact Information
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          If you have any questions about these Terms of Service, please contact us:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
          <li>
            Email: <strong>support@clipfire.app</strong>
          </li>
          <li>
            Website:{' '}
            <a href="https://polemicyst.com" className="text-blue-500 hover:underline">
              https://polemicyst.com
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
};

export default TermsOfService;
