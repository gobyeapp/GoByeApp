import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

/** The looping road clip on iOS and Android (expo-video). The web build uses RoadVideo.web.tsx. */
export function RoadVideo({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />;
}
