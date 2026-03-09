'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ArrowLeft, Loader2, Send, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { ThemedToaster } from '@/components/themed-toaster';

type ChatMessageData = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

type AnalysisResult = {
  summary: string;
  overallCredibility: number;
  overallBiasLevel: string;
  assertions: unknown[];
  fallacies: unknown[];
  biases: unknown[];
};

export default function ChatPage() {
  const { feedVideoId } = useParams<{ feedVideoId: string }>();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [videoTitle, setVideoTitle] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load chat history + analysis on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Fetch chat history and video title in parallel
        const [chatRes, videoRes] = await Promise.all([
          fetch(`/api/feedVideos/${feedVideoId}/truth-analysis/chat`),
          fetch(`/api/feedVideos/${feedVideoId}`),
        ]);

        if (!cancelled) {
          if (chatRes.ok) {
            const data = await chatRes.json();
            if (data.chat?.messages) {
              setMessages(data.chat.messages);
            }
            if (data.analysis) {
              setAnalysis(data.analysis);
            }
          }
          if (videoRes.ok) {
            const videoData = await videoRes.json();
            setVideoTitle(videoData?.feedVideo?.title || '');
          }
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [feedVideoId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setInput('');
    setSending(true);

    // Optimistic user message
    const userMsg: ChatMessageData = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/truth-analysis/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.message.content }]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
      // Remove optimistic message on error
      setMessages((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, sending, feedVideoId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }, []);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-var(--navbar-height))] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex h-[calc(100vh-var(--navbar-height))] flex-col items-center justify-center gap-4 px-4">
        <MessageSquare className="h-12 w-12 text-muted-foreground/50" />
        <div className="text-center">
          <h2 className="text-lg font-medium">No analysis found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Run &ldquo;Verify with AI&rdquo; on this video first, then come back to chat about the
            results.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Go back
        </Button>
      </div>
    );
  }

  const credColor =
    analysis.overallCredibility >= 7
      ? 'text-green-600 dark:text-green-400'
      : analysis.overallCredibility >= 4
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] flex-col">
      <ThemedToaster />

      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{videoTitle || 'Chat about analysis'}</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">AI Analysis Chat</span>
            <Badge variant="outline" className={cn('text-xs', credColor)}>
              Credibility: {analysis.overallCredibility}/10
            </Badge>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Analysis summary banner */}
        <div className="mx-auto mb-6 max-w-2xl rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Analysis Summary</p>
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{analysis.assertions.length} assertions</span>
            <span>&middot;</span>
            <span>{analysis.fallacies.length} fallacies</span>
            <span>&middot;</span>
            <span>{analysis.biases.length} biases</span>
          </div>
        </div>

        {/* Welcome message if no messages yet */}
        {messages.length === 0 && (
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm text-muted-foreground">
              Ask questions about the analysis, specific claims, fallacies, or biases identified in
              the transcript.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[
                'What are the strongest claims?',
                'Which fallacies are most concerning?',
                'How biased is this content?',
                'What should I fact-check first?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                )}
              >
                {msg.role === 'assistant' ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-muted px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the analysis..."
            rows={1}
            disabled={sending}
            className="flex-1 resize-none rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="shrink-0 rounded-xl"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight client-side markdown → HTML.
 * Handles bold, italic, inline code, code blocks, links, lists, and paragraphs.
 */
function renderMarkdown(text: string): string {
  // Escape HTML
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers (## Header)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newlines)
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (
        trimmed.startsWith('<h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('<pre') ||
        trimmed.startsWith('<li')
      ) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  return html;
}
