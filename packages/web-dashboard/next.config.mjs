export default {
  transpilePackages: ['@open-nexlev/niche-engine'],
  serverExternalPackages: ['better-sqlite3'],
  webpack(config) {
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
