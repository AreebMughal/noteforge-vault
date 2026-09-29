/**
 * Adds a release signing config to the generated android/app/build.gradle.
 * The keystore is supplied by CI through environment variables, never committed:
 *   NF_UPLOAD_STORE_FILE, NF_UPLOAD_STORE_PASSWORD, NF_UPLOAD_KEY_ALIAS, NF_UPLOAD_KEY_PASSWORD
 * Without them, release builds fall back to the debug key (fine for local testing only).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes('nfRelease')) return cfg;
    g = g.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        nfRelease {
            if (System.getenv('NF_UPLOAD_STORE_FILE')) {
                storeFile file(System.getenv('NF_UPLOAD_STORE_FILE'))
                storePassword System.getenv('NF_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('NF_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('NF_UPLOAD_KEY_PASSWORD')
            }
        }`,
    );
    g = g.replace(
      /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig System.getenv('NF_UPLOAD_STORE_FILE') ? signingConfigs.nfRelease : signingConfigs.debug`,
    );
    cfg.modResults.contents = g;
    return cfg;
  });
};
