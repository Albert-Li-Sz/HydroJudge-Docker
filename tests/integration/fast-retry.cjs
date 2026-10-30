'use strict';

// Accelerate only the production reconnect delay in isolated protocol fixtures.
// This preload is never installed or enabled in the production image.
const originalSetTimeout = global.setTimeout;
global.setTimeout = (callback, milliseconds, ...args) => originalSetTimeout(callback,
  milliseconds === 30000 ? 100 : milliseconds, ...args);
