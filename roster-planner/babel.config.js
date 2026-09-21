// © 2026 David Juste. All rights reserved. Proprietary and confidential.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
