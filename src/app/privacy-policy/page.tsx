import React from 'react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Privacy Policy for Polemicyst
      </h1>
      <p className="text-gray-700 dark:text-gray-300 mb-4">
        <strong>Last Updated: [Insert Date]</strong>
      </p>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          1. Information We Collect
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          When you log in using Google OAuth, we collect your <strong>name, email address, and profile picture</strong>. We do not store your password or sensitive authentication details.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          2. How We Use Your Information
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We use your <strong>email and profile information</strong> to authenticate your login and enhance your experience. Your information is <strong>never shared, sold, or distributed</strong> to third parties.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          3. Third-Party Services
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Our website includes integrations with Google OAuth. Google OAuth authentication follows Google’s{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            Privacy Policy
          </a>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          4. Data Security
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We use <strong>industry-standard security measures</strong> to protect your data. If you have any concerns about your data, contact us at <strong>[your-email@polemicyst.com]</strong>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          5. Contact Information
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          If you have any questions, please contact us:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
          <li>📧 Email: <strong>[your-email@polemicyst.com]</strong></li>
          <li>🌐 Website: <a href="https://polemicyst.com" className="text-blue-500 hover:underline">https://polemicyst.com</a></li>
        </ul>
      </section>
    </div>
  );
};

export default PrivacyPolicy;
