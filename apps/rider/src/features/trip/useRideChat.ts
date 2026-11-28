import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRideChat, quickRepliesFor, type ChatMessage } from '@gobye/core';
import type { ChatBubble } from '@gobye/ui';
import { snapForChat } from './snap';
import { relay } from '@/state/relay';

/**
 * Messages with the other person on this ride (D-108). Works when the ride is shared over the demo
 * connection; otherwise `available` is false and the screen says so. `onIncoming` fires for a new
 * message from the other side (the screen shows it as a notice when the conversation is closed).
 */
export function useRideChat(rideId: string | null, me: 'rider' | 'driver', onIncoming?: (text: string) => void) {
  const chat = useMemo(() => (relay && rideId ? createRideChat(relay, { rideId, me }) : null), [rideId, me]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seen = useRef(0);
  const incoming = useRef(onIncoming);
  incoming.current = onIncoming;

  useEffect(() => {
    setMessages([]);
    seen.current = 0;
    if (!chat) return;
    let first = true;
    return chat.watch((all) => {
      const fresh = all.slice(seen.current).filter((m) => m.from !== me);
      seen.current = all.length;
      setMessages(all);
      // Messages already there when the screen opens aren't announced again.
      if (!first && fresh.length) incoming.current?.(fresh[fresh.length - 1]!.image ? 'sent a photo of where they are' : fresh[fresh.length - 1]!.text);
      first = false;
    });
  }, [chat, me]);

  const send = useCallback(
    async (text: string): Promise<string | null> => {
      if (!chat) return 'Messages need the shared connection, which is off in this build.';
      const r = await chat.send(text);
      if (!r.ok) return r.error;
      setMessages((prev) => (prev.some((m) => m.id === r.value.id) ? prev : [...prev, r.value]));
      seen.current += 1;
      return null;
    },
    [chat],
  );

  /** Take a photo of where you are and send it. Null when sent or when the person backed out. */
  const sendPhoto = useCallback(async (): Promise<string | null> => {
    if (!chat) return 'Messages need the shared connection, which is off in this build.';
    const shot = await snapForChat();
    if (!shot.ok) return shot.error;
    if (!shot.image) return null;
    const r = await chat.sendPhoto(shot.image);
    if (!r.ok) return r.error;
    setMessages((prev) => (prev.some((m) => m.id === r.value.id) ? prev : [...prev, r.value]));
    seen.current += 1;
    return null;
  }, [chat]);

  const bubbles: ChatBubble[] = useMemo(() => messages.map((m) => ({ id: m.id, mine: m.from === me, text: m.text, image: m.image, at: m.at })), [messages, me]);
  // The one-tap messages follow the conversation: asked "where are you?", the buttons become answers.
  const quickReplies = useMemo(() => quickRepliesFor(me, messages), [me, messages]);
  return { available: !!chat, bubbles, quickReplies, send, sendPhoto };
}
