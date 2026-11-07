const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Só o que o app importa da web. Vigiar a raiz inteira levaria o Metro a varrer o
// node_modules e os arquivos do autodesenvolvimento.
config.watchFolders = ['../../src/scene', '../../src/lib'].map((pasta) =>
  path.resolve(__dirname, pasta),
);

module.exports = config;
