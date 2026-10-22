// Minimal timer globals shared by Hermes, Node and browsers; keeps @gobye/core free of DOM/Node libs.
declare function setTimeout(callback: () => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;
