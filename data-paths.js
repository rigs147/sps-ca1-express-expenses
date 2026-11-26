const path = require('node:path');

const dataDir = path.resolve(process.env.MERIDIAN_DATA_DIR || __dirname);

module.exports = {
  databaseFile: path.join(dataDir, 'expenses.db'),
  receiptsDir: path.join(dataDir, 'receipts'),
};