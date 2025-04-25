'use client';

import { useState, useEffect } from 'react';

export default function FeedsPage() {
  const [feeds, setFeeds] = useState([]);
  const [form, setForm] = useState({ name: '', sourceUrl: '', pollingInterval: 60 });

  const fetchFeeds = async () => {
    const res = await fetch('/api/feeds');
    const data = await res.json();
    setFeeds(data);
  };

  useEffect(() => {
    fetchFeeds();
  }, []);

  const addFeed = async () => {
    await fetch('/api/feeds', {
      method: 'POST',
      body: JSON.stringify(form),
      headers: { 'Content-Type': 'application/json' },
    });
    setForm({ name: '', sourceUrl: '', pollingInterval: 60 });
    fetchFeeds();
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Video Feeds</h1>
      <input
        placeholder="Name"
        className="border p-2 mr-2"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        placeholder="Source URL"
        className="border p-2 mr-2"
        value={form.sourceUrl}
        onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
      />
      <input
        type="number"
        placeholder="Polling Interval"
        className="border p-2 mr-2"
        value={form.pollingInterval}
        onChange={(e) => setForm({ ...form, pollingInterval: +e.target.value })}
      />
      <button onClick={addFeed} className="bg-blue-600 text-white p-2 rounded">Add Feed</button>

      <ul className="mt-6">
        {feeds.map((feed: any) => (
          <li key={feed.id} className="mb-2">
            <strong>{feed.name}</strong> — {feed.sourceUrl} — every {feed.pollingInterval} min
          </li>
        ))}
      </ul>
    </div>
  );
}
