const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// kdbxweb does `require("crypto")` at load time; point it at the JSI-native
// implementation (the WebCrypto path is what it actually uses once global.crypto is installed).
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'crypto') return context.resolveRequest(context, 'react-native-quick-crypto', platform);
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
