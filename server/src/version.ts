/**
 * The product version, read from the ROOT package.json at build time (esbuild
 * inlines the JSON; tsx resolves it in dev). Bump that one field to release —
 * it flows to GET /api/health, GET /api/capabilities, the boot banner and the
 * dashboard sidebar. The workspace package.json files mirror it for tidiness
 * but nothing reads them.
 */
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
