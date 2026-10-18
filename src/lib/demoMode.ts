// How a deployment runs as a public demo (see src/lib/demo.ts). No imports, so any module can ask.

/** DOMINO_OPEN_DEMO=true: what a visitor needs to try the product works without the access key (admin actions still need it). */
export const openDemo = () => process.env.DOMINO_OPEN_DEMO === 'true';

/** DOMINO_DEMO_RESET=nightly: the nightly cron rebuilds every clinic from the seed. */
export const nightlyReset = () => process.env.DOMINO_DEMO_RESET === 'nightly';
