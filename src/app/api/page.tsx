'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function Home() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, text, html }),
    });

    const data = await response.json();
    alert(data.message);
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Send Email</h1>
      <form onSubmit={handleSubmit}>
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="space-y-2">
              <Label>To</Label>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Text</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                className="h-32"
              />
            </div>
            <div className="space-y-2">
              <Label>HTML</Label>
              <Textarea value={html} onChange={(e) => setHtml(e.target.value)} className="h-32" />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Send Email</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
