const process = require('process');
const path = require('path');
const webpack = require('webpack');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const createStyledComponentsTransformer = require('typescript-plugin-styled-components').default;
const HtmlWebpackPlugin = require('html-webpack-plugin');

const styledComponentsTransformer = createStyledComponentsTransformer();

module.exports = {
  entry: './src/index.tsx',
  output: {
    filename: 'encryptedfs.js',
    path: path.resolve(__dirname, 'dist')
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
    extensions: [".ts", ".tsx", ".js"],
    plugins: [new TsconfigPathsPlugin()]
  },
  module: {
    rules: [
      {
        test: /.tsx?$/,
        loader: 'ts-loader',
        options: {
          getCustomTransformers: () => ({ before: [styledComponentsTransformer] }),
        },
      }
    ]
  },
  plugins: [
    new webpack.EnvironmentPlugin([
      'HOST',
      'PORT'
    ]),
    new HtmlWebpackPlugin({
      template: '!!ejs-compiled-loader!src/index.ejs',
      inject: 'body',
      xhtml: true,
      filename: 'index.html',
      templateParameters: {
        title: 'TypeScript Demo',
        configJs: `
          window.config = {
            HOST: '${process.env.HOST}',
            PORT: '${process.env.PORT}'
          };
        `
      }
    })
  ],
  watchOptions: {
    ignored: /node_modules/
  }
};
