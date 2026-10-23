/** Dependency-injection tokens (explicit, so wiring never depends on emitted type metadata alone). */
export const CONFIG = Symbol('CONFIG');
export const DATABASE = Symbol('DATABASE');
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
export const PRINCIPALS = Symbol('PRINCIPALS');
export const MIGRATIONS = Symbol('MIGRATIONS');
export const PROVIDERS = Symbol('PROVIDERS');
export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const CLOCK = Symbol('CLOCK');
