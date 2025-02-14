import React from "react";

const PrivacyPolicy = () => {
  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>

      <p className="mb-4">
        We respect your privacy and are committed to protecting it. This Privacy Policy outlines the types of 
        information we do and do not collect and how we use it.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-4">1. Information We Collect</h2>
      <p className="mb-4">
        This application does not collect, store, or share any user data. We do not track users or store any personal information.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-4">2. Third-Party Services</h2>
      <p className="mb-4">
        Our application may integrate with third-party APIs such as Facebook and Instagram for publishing content.
        These platforms may collect data based on their own privacy policies.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-4">3. Changes to This Policy</h2>
      <p className="mb-4">
        We may update this Privacy Policy from time to time. Any changes will be posted on this page.
      </p>

      <h2 className="text-2xl font-semibold mt-6 mb-4">4. Contact Us</h2>
      <p className="mb-4">
        If you have any questions about this Privacy Policy, you can contact us at:
      </p>
      <p className="font-semibold">Email: polemicist1667@gmail.com</p>

      <p className="mt-6">Last updated: {new Date().toISOString().split("T")[0]}</p>
    </div>
  );
};

export default PrivacyPolicy;
