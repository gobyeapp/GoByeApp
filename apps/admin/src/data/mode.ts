/**
 * Demo tools (D-070). The admin shows no "prototype", "test data" or "simulated" labels: the same
 * screens run on generated data now and on the live API later, with nothing to strip out. Tools that
 * only make sense without a real backend (simulate a provider event, reset the data, simulate server
 * failures, load example origins) appear only when the build sets VITE_DEMO_TOOLS=true. Production
 * builds leave it unset, so those tools never ship.
 */
export const DEMO_TOOLS = import.meta.env.VITE_DEMO_TOOLS === 'true';
