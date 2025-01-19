// src/app/components/Notifications.tsx

'use client';

import React, { useEffect, useState } from 'react';
import { Case } from '../../util/scrapeCases';

const Notifications: React.FC = () => {
  const [decisions, setDecisions] = useState<Case[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const response = await fetch('/api/checkCases');
        const data = await response.json();
        // setDecisions(data.newCases);
        setDecisions(data.storedCases);

        if (data.newCases.length > 0) {
          sendBrowserNotifications(data.newCases);
        }

        setLoading(false);
      } catch (error) {
        console.error('Error fetching decisions:', error);
        setLoading(false);
      }
    };

    fetchDecisions();

    // Fetch every hour
    const interval = setInterval(() => {
      fetchDecisions();
    }, 3600000);

    return () => clearInterval(interval);
  }, []);

  const sendBrowserNotifications = (newCases: Case[]) => {
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications.');
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        newCases.forEach((decision) => {
          new Notification('New Supreme Court Decision', {
            body: `${decision.name} - Docket: ${decision.docket}`,
            icon: '/path/to/icon.png', // Update to your icon path
          });
        });
      }
    });
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Supreme Court Decisions</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        decisions.map((decision) => (
          <div key={decision.number} className="mb-4 border p-4 rounded shadow">
            <h2 className="text-xl font-semibold">{decision.name}</h2>
            {/* <p>Date Filed: {new Date(decision.date).toLocaleDateString()}</p> */}
            <p>Date Filed: {decision.date}</p>
            <p>Docket: {decision.docket}</p>
            <p>Judge: {decision.judge}</p>
            <p>Citation: {decision.citation}</p>
            <a
              href="https://www.supremecourt.gov/opinions/slipopinion/23"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              Read More
            </a>
          </div>
        ))
      )}
    </div>
  );
};

export default Notifications;
