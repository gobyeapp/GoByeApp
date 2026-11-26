/**
 * Demo tools (D-070). The admin shows no "prototype", "test data" or "simulated" labels: the same
 * screens run on generated data now and on the live API later, with nothing to strip out. Tools that
 * only make sense without a real backend (simulate a provider event, reset the data, simulate server
 * failures, load example origins) appear only when the build sets VITE_DEMO_TOOLS=true. Production
 * builds leave it unset, so those tools never ship.
 */
export const DEMO_TOOLS = import.meta.env.VITE_DEMO_TOOLS === 'true';

/**
 * Connected demo page only (D-075). On when the build is given a demo relay address
 * (VITE_DEMO_RELAY_URL), without turning on the other demo tools. The deploy workflow passes the
 * address to preview builds only, so production never shows it.
 */
// Written as a plain comparison so Vite can fold it to `false` and drop the page when the address is unset.
export const DEMO_RELAY = import.meta.env.VITE_DEMO_RELAY_URL !== undefined && import.meta.env.VITE_DEMO_RELAY_URL !== '';
