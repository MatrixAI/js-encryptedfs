const path = require('path');
const ThreadsPlugin = require('threads-plugin');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'encryptedfs.js',
    library: 'encryptedfs',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  devtool: "source-map",
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },
  node: {
    fs: 'empty'
  },
  module: {
    rules: [
      {
        test: /.tsx?$/,
        loader: 'ts-loader'
      }
    ]
  },
  externals: [
    nodeExternals()
  ],
  plugins: [
    new ThreadsPlugin({
      globalObject: false
    })
  ],
  watchOptions: {
    ignored: /node_modules/
  }
};
