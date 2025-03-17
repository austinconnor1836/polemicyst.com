import React from 'react';

const TermsOfService: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Terms of Service for Polemicyst
      </h1>
      <p className="text-gray-700 dark:text-gray-300 mb-4">
        <strong>Last Updated: [Insert Date]</strong>
      </p>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          1. Acceptance of Terms
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          By accessing and using Polemicyst, you agree to comply with these Terms of Service. If you do not agree, please do not use our website or services.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          2. Use of the Service
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          You agree to use Polemicyst for lawful purposes only. Misuse of the platform, including spamming, harassment, or unlawful activity, is strictly prohibited.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          3. User Accounts
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          You may be required to create an account to access certain features. You are responsible for maintaining the security of your account credentials.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          4. Content Ownership
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Users retain ownership of any content they submit. However, by submitting content, you grant Polemicyst a license to use, modify, and display the content as necessary.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          5. Termination
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We reserve the right to terminate or suspend access to our services at our discretion if we believe you have violated these terms.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          6. Changes to These Terms
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          We may update these Terms of Service from time to time. Users will be notified of significant changes.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          7. Contact Information
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          If you have any questions about these Terms of Service, please contact us:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
          <li>📧 Email: <strong>[your-email@polemicyst.com]</strong></li>
          <li>🌐 Website: <a href="https://polemicyst.com" className="text-blue-500 hover:underline">https://polemicyst.com</a></li>
        </ul>
      </section>
    </div>
  );
};

export default TermsOfService;
