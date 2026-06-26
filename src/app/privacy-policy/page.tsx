import React from 'react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Privacy Policy for Clipfire
      </h1>
      <p className="text-gray-700 dark:text-gray-300 mb-4">
        <strong>Last Updated: June 11, 2026</strong>
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
          4. Third-Party Processors
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          To operate Clipfire we share specific data with the following processors. Each receives
          only the data needed to perform its function and is bound by its own privacy terms.
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 space-y-2">
          <li>
            <strong>Stripe</strong> — handles subscription billing and payment processing. Stripe
            receives your email, billing details, and subscription state; it does not receive your
            video content.
          </li>
          <li>
            <strong>Amazon Web Services (S3, us-east-1)</strong> — stores your uploaded source
            videos, generated clips, and rendered compositions in encrypted buckets in the US-East-1
            region.
          </li>
          <li>
            <strong>Google Gemini</strong> — performs AI scoring of viral moments and truth-analysis
            of video content. We send transcripts, video frames, and optional audio to Gemini for
            analysis; results are stored in your account.
          </li>
          <li>
            <strong>Faster-Whisper (self-hosted)</strong> — transcribes audio when YouTube captions
            are unavailable. Whisper runs on infrastructure we operate; no audio leaves our systems
            for transcription.
          </li>
          <li>
            <strong>Google, Apple, Facebook, Twitter (X), and Bluesky OAuth</strong> — authenticate
            sign-in and, where you connect them, publish clips to your accounts. Each provider
            receives the OAuth handshake; we receive a token, your basic profile, and (for publish
            destinations) permission to post on your behalf.
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          5. Data Storage and Security
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          Your data is stored securely on AWS infrastructure in the US-East-1 region. We use{' '}
          <strong>industry-standard security measures</strong> including encrypted connections
          (HTTPS), secure database access, and encrypted token storage on mobile devices.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          6. Data Used to Improve Our Models
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          Clipfire is working toward replacing third-party AI providers with our own privately
          hosted models. To make that possible, we may retain the inputs and outputs of AI calls
          made on your behalf as <strong>training examples</strong>. This includes:
        </p>
        <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 space-y-1 mb-3">
          <li>
            <strong>Clip scoring data</strong> — transcript windows, target platform, content style,
            and the resulting AI scores and selection decisions.
          </li>
          <li>
            <strong>Truth-analysis data</strong> — transcripts sent for fact-check / credibility
            analysis, plus the full prompts and responses for any analysis chat conversations.
          </li>
        </ul>
        <p className="text-gray-700 dark:text-gray-300 mb-3">
          We do <strong>not</strong> sell this data and do <strong>not</strong> share it with third
          parties for their own model training. It is used solely to fine-tune Clipfire&apos;s
          internal models.
        </p>
        <p className="text-gray-700 dark:text-gray-300">
          <strong>Opting out:</strong> if you do not want your inputs and outputs retained as
          training examples, email{' '}
          <a href="mailto:support@clipfire.app" className="text-blue-500 hover:underline">
            support@clipfire.app
          </a>{' '}
          and we will exclude your account from future training collection and delete existing
          examples linked to your user ID. A programmatic in-app opt-out is on our roadmap.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          7. Data Retention and Deletion
        </h2>
        <p className="text-gray-700 dark:text-gray-300">
          You may request deletion of your account and all associated data at any time by contacting
          us. Upon account deletion, all personal data, connected accounts, videos, and generated
          clips will be permanently removed.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          8. Contact Information
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
