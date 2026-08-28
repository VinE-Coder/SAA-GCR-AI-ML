/* Deployment configuration.
 *
 * Leave SAA_API empty for local development: store.js then falls back to
 * localStorage and the footer says so. Set it to the deployed Worker URL to use the
 * shared database. A volunteer's invite link supplies the token as ?t=<token>, and
 * BOTH the API base and a token must be present before the API backend is used.
 */
window.SAA_API = '';
