import { useNavigate } from 'react-router-dom';
import { useSession } from '@/data/session';
import { ALL_ITEMS } from '@/nav';
import { LAGOS } from '@/ui/kit';

/** "Good morning" by the hour in Lagos. */
export function greeting(now: number) {
  const h = Number(new Date(now).toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: LAGOS }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Navigate to a page only when the viewer's role can open it; undefined otherwise (button shows why). */
export function useOpener() {
  const navigate = useNavigate();
  const { can } = useSession();
  return (path: string) => {
    const item = ALL_ITEMS.find((i) => i.path === path);
    return item && item.anyOf.some((p) => can(p)) ? () => navigate(path) : undefined;
  };
}
