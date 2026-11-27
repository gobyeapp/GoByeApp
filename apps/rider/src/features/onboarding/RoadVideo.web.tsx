import { useEffect, useRef, useState } from 'react';

/**
 * Safari on iPhone draws its own play button over a video it won't start by itself (Low Power Mode does
 * this). These rules remove Safari's built-in video buttons for this clip; it is decoration, never something to tap.
 */
const HIDE_SAFARI_BUTTONS = `
video.gobye-road::-webkit-media-controls,
video.gobye-road::-webkit-media-controls-panel,
video.gobye-road::-webkit-media-controls-play-button,
video.gobye-road::-webkit-media-controls-start-playback-button,
video.gobye-road::-webkit-media-controls-overlay-play-button { display: none !important; -webkit-appearance: none; opacity: 0; }
`;

/**
 * The looping road clip in browsers. A plain <video> with the attributes Safari on iPhone needs to play
 * a clip by itself: muted, inline (not fullscreen) and without controls. It stays invisible until it is
 * actually moving, so until then the still picture underneath shows: never a paused frame or a play
 * button. If the browser holds it back (iPhone Low Power Mode), it starts on the first touch anywhere.
 */
export function RoadVideo({ source }: { source: number | string | { uri: string } }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // In a web build, `require('….mp4')` is the file's URL (a string); keep an object form working too.
  const uri = typeof source === 'string' ? source : typeof source === 'object' ? source.uri : undefined;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('pause', onPause);
    const onTouch = () => {
      void v.play().catch(() => undefined);
      removeTouch();
    };
    const removeTouch = () => {
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('click', onTouch);
    };
    v.play().catch(() => {
      document.addEventListener('touchstart', onTouch, { passive: true });
      document.addEventListener('click', onTouch);
    });
    return () => {
      removeTouch();
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('pause', onPause);
    };
  }, [uri]);

  return (
    <>
      <style>{HIDE_SAFARI_BUTTONS}</style>
      <video
        ref={ref}
        className="gobye-road"
        src={uri}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden
        tabIndex={-1}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', opacity: playing ? 1 : 0, transition: 'opacity 200ms ease' }}
      />
    </>
  );
}
