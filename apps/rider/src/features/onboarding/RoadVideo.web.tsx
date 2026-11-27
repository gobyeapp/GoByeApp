import { useEffect, useRef } from 'react';

/**
 * The looping road clip in browsers. A plain <video> with the attributes Safari on iPhone needs to play
 * a clip by itself: muted, inline (not fullscreen) and without controls. If the browser still holds it
 * back (iPhone Low Power Mode does), it starts on the first touch anywhere on the page.
 */
export function RoadVideo({ source }: { source: number | string | { uri: string } }) {
  const ref = useRef<HTMLVideoElement>(null);
  // In a web build, `require('….mp4')` is the file's URL (a string); keep an object form working too.
  const uri = typeof source === 'string' ? source : typeof source === 'object' ? source.uri : undefined;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    const start = () => {
      void v.play().catch(() => undefined);
    };
    const onTouch = () => {
      start();
      remove();
    };
    const remove = () => {
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('click', onTouch);
    };
    v.play().catch(() => {
      document.addEventListener('touchstart', onTouch, { passive: true });
      document.addEventListener('click', onTouch);
    });
    return remove;
  }, [uri]);

  return (
    <video
      ref={ref}
      src={uri}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden
      tabIndex={-1}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
    />
  );
}
