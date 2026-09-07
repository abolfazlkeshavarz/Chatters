module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // react-native-reanimated is not used, but gesture-handler + navigation
      // want this to be the last plugin if it is ever added.
    ],
  };
};
