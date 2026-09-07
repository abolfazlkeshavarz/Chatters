// Default Expo Metro config. react-native-quick-crypto ships prebuilt native
// code and needs no Metro customisation; this file exists so additions later
// have somewhere obvious to go.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
