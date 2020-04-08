const process = require('process');
const path = require('path');
const webpack = require('webpack');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const createStyledComponentsTransformer = require('typescript-plugin-styled-components').default;
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ThreadsPlugin = require('threads-plugin');
const nodeExternals = require('webpack-node-externals');
const styledComponentsTransformer = createStyledComponentsTransformer();

module.exports = {
  entry: './src/index.ts',
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'encryptedfs.js',
    library: 'encryptedfs',
    libraryTarget: 'umd',
  },
  externals: {
    virtualfs: "virtualfs",
    threads: "threads",
  },
  devtool: "source-map",
  devServer: {
    host: process.env.HOST,
    port: process.env.PORT,
    historyApiFallback: true,
    watchContentBase: true,
    contentBase: path.resolve(__dirname, 'dist'),
    publicPath: '/'
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    plugins: [new TsconfigPathsPlugin()]
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
  externals: [nodeExternals()],
  plugins: [
    new ThreadsPlugin({
      globalObject: false
    }),
    new webpack.EnvironmentPlugin([
      'HOST',
      'PORT'
    ]),
    new HtmlWebpackPlugin({
      // template: '!!ejs-compiled-loader!src/index.ejs',
      // inject: 'body',
      // xhtml: true,
      // filename: 'index.html',
      // templateParameters: {
      //   title: 'TypeScript Demo',
      //   configJs: `
      //     window.config = {
      //       HOST: '${process.env.HOST}',
      //       PORT: '${process.env.PORT}'
      //     };
      //   `
      // }
    })
  ],
  watchOptions: {
    ignored: /node_modules/
  }
};
