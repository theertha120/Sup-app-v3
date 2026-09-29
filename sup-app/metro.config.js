// Sentry's Metro config adds Debug IDs so release stack traces can be symbolicated.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
