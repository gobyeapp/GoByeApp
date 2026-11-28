import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRideChat, type ChatMessage } from '@gobye/core';
import type { ChatBubble } from '@gobye/ui';
import { useRelay } from '@/state/relay';

/**
 * Messages with the other person on this ride (D-108). Works when the ride is shared over the demo
 * connection; otherwise `available` is false and the screen says so. `onIncoming` fires for a new
 * message from the other side (the screen shows it as a notice when the conversation is closed).
 */
export function useRideChat(rideId: string | null, me: 'rider' | 'driver', onIncoming?: (text: string) => void) {
  const relay = useRelay();
  const chat = useMemo(() => (relay && rideId ? createRideChat(relay, { rideId, me }) : null), [relay, rideId, me]);
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
      if (!first && fresh.length) incoming.current?.(fresh[fresh.length - 1]!.text);
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

  const bubbles: ChatBubble[] = useMemo(() => messages.map((m) => ({ id: m.id, mine: m.from === me, text: m.text, at: m.at })), [messages, me]);
  return { available: !!chat, bubbles, send };
}
