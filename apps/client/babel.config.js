/** NativeWind 4: classes compile through the css-interop JSX runtime (see metro.config.js). */
module.exports = (api) => {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
