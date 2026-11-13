import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DataPlatform from './DataPlatform';

/** Visible copy rule (as in the other admin pages): no dashes or exclamation marks; file paths in <code> are identifiers. */
function visibleTextProblems(container: HTMLElement) {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.parentElement?.closest('code'))) continue;
    for (const w of (n.textContent ?? '').split(/\s+/)) if (/[—–!]/.test(w) || /[a-z]-[a-z]/i.test(w)) out.push(w);
  }
  return out;
}

describe('Data platform page (D-065)', () => {
  it('shows the providers in use, the readiness checks, a move plan and the options, as reference only', () => {
    const { container } = render(<DataPlatform />);
    expect(screen.getByRole('heading', { name: 'Data platform' })).toBeTruthy();
    expect(screen.getAllByText('Supabase (PostgreSQL)').length).toBeGreaterThan(0);
    expect(screen.getByText('Supabase Auth')).toBeTruthy();
    expect(screen.getByText(/not live monitoring/)).toBeTruthy();
    expect(screen.getByText('Standard PostgreSQL only')).toBeTruthy();
    expect(screen.getByText('Neon')).toBeTruthy();
    // Database-only plan: no sign-in switch step; switching to both shows it.
    expect(screen.queryByText('Switch sign in')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Database and sign in' }));
    expect(screen.getByText('Switch sign in')).toBeTruthy();
    expect(visibleTextProblems(container)).toEqual([]);
    cleanup();
  });

  it('filters the checks by area', () => {
    render(<DataPlatform />);
    const filter = within(screen.getByRole('group', { name: 'Show checks for' }));
    fireEvent.click(filter.getByRole('button', { name: 'Database' }));
    expect(screen.queryByText('User ids must move with the users')).toBeNull();
    fireEvent.click(filter.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('User ids must move with the users')).toBeTruthy();
    cleanup();
  });
});
