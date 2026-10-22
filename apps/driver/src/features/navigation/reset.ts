import { router, type Href } from 'expo-router';

/** Replace the whole stack with `href` so Android back can't return to finished flows (sign-in, a trip). */
export function resetTo(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}
