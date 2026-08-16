'use strict';

// Backward-compatible import path. One shared module instance is essential so
// every command, config proxy and database facade uses the same ALS context.
module.exports = require('./core/botContext');
