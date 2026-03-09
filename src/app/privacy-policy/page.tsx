import React from 'react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Privacy Policy for Clipfire
      </h1>
      <p className="text-gray-700 dark:text-gray-300 mb-4">
        <strong>Last Updated: March 9, 2026</strong>
      </p>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          1. Information We Collect
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          When you log in using Google OAuth or Sign in with Apple, we collect your{' '}
          <strong>name, email address, and profile picture</strong>. We do not store your password
          or sensitive authentication details. We also collect data about your connected YouTube
          channels, imported videos, and generated clips to provide our services.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          2. How We Use Your Information
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We use your <strong>email and profile information</strong> to authenticate your login and
          provide our clip generation services. Video data is processed by AI to identify viral
          moments and generate clips. Your information is{' '}
          <strong>never shared, sold, or distributed</strong> to third parties for marketing
          purposes.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          3. Third-Party Services
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Clipfire integrates with Google OAuth, Sign in with Apple, and the YouTube Data API.
          Authentication follows each provider&apos;s respective privacy policies:{' '}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            Google Privacy Policy
          </a>
          ,{' '}
          <a
            href="https://www.apple.com/legal/privacy/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            Apple Privacy Policy
          </a>
          . We use AI services (Google Gemini) to analyze video content for clip generation.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          4. Data Storage and Security
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Your data is stored securely on AWS infrastructure in the US-East-1 region. We use{' '}
          <strong>industry-standard security measures</strong> including encrypted connections
          (HTTPS), secure database access, and encrypted token storage on mobile devices.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          5. Data Retention and Deletion
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          You may request deletion of your account and all associated data at any time by contacting
          us. Upon account deletion, all personal data, connected accounts, videos, and generated
          clips will be permanently removed.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          6. Contact Information
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          If you have any questions, please contact us:
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

export default PrivacyPolicy;
