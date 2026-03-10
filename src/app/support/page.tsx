import React from 'react';

const Support: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">Clipfire Support</h1>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Get Help</h2>
        <p className="text-gray-700 dark:text-gray-300">
          Need help with Clipfire? We&apos;re here to assist you. Reach out to our support team and
          we&apos;ll get back to you as soon as possible.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Contact Us</h2>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 space-y-2">
          <li>
            Email: <strong>support@clipfire.app</strong>
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Frequently Asked Questions
        </h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              How do I connect my YouTube channel?
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Go to the Accounts tab and tap &quot;Add Account&quot; to connect your YouTube channel
              via Google OAuth.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              How are clips generated?
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Clipfire uses AI to analyze your video transcripts and identify the most engaging
              moments. It scores each segment for hook strength, context, and shareability, then
              generates short clips optimized for your target platform.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              How do I cancel my subscription?
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              You can manage your subscription from the Settings tab under &quot;Subscription &amp;
              Billing&quot;.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              How do I delete my account?
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Contact us at support@clipfire.app and we will process your account deletion request
              within 48 hours.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Support;
