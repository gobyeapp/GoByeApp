/**
 * Dark map style for Google Maps (Android) so the map follows the app's dark appearance.
 * Neutral greys to match the monochrome interface (D-034); Apple Maps follows `userInterfaceStyle`.
 */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9E9E9E' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8A8A8A' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1B1F1B' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2A2A2A' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1A1A1A' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3A3A3A' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#B5B5B5' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#202020' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A0F14' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5E6670' }] },
];
