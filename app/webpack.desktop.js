const path = require('path')
const webpack = require('webpack')
const pkg = require('./package.json')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const {CleanWebpackPlugin} = require('clean-webpack-plugin')
const BundleAnalyzerPlugin = require(
  'webpack-bundle-analyzer').BundleAnalyzerPlugin
const TerserPlugin = require('terser-webpack-plugin')

module.exports = (env, argv) => {
  return {
    mode: argv.mode || 'development',
    watch: argv.mode !== 'production',
    devtool: argv.mode !== 'production' ? 'eval' : false,
    output: {
      publicPath: '',
      filename: '[name].[chunkhash].js',
      path: path.resolve(__dirname, 'stage/build/desktop'),
    },
    entry: {
      'main': './src/index.ts',
    },
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
      ],
    },
    resolve: {
      fallback: {
        'path': require.resolve('path-browserify'),
      },
      extensions: ['.ts', '.js', '.tpl', '.scss'],
    },
    module: {
      rules: [
        {
          test: /\.tpl/,
          include: [
            path.resolve(__dirname, 'src/assets/template/desktop/index.tpl')],
          loader: 'html-loader',
          options: {
            sources: false,
          },
        },
        {
          test: /\.js$/,
          include: [path.resolve(__dirname, 'src/asset/pdf')],
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
              plugins: [
                [
                  '@babel/plugin-transform-runtime',
                  {
                    helpers: false,
                    regenerator: true,
                  },
                ],
              ],
            },
          },
        },
        {
          test: /\.ts(x?)$/,
          include: [path.resolve(__dirname, 'src')],
          use: [
            {
              loader: 'ts-loader',
            },
            {
              loader: 'ifdef-loader',
              options: {
                'ifdef-verbose': false,
                BROWSER: true,
                MOBILE: false,
              },
            },
          ],
        },
        {
          test: /\.scss$/,
          include: [
            path.resolve(__dirname, 'src/assets/scss'),
          ],
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader', // translates CSS into CommonJS
            },
            {
              loader: 'sass-loader', // compiles Sass to CSS
            },
          ],
        },
        {
          test: /\.woff$/,
          type: 'asset/resource',
          generator: {
            filename: '../fonts/JetBrainsMono-Regular.woff',
          },
        },
        {
          test: /\.(png|svg)$/,
          use: [
            {
              loader: 'file-loader',
              options: {
                name: '[name].[ext]',
                outputPath: '../../',
              },
            },
          ],
        },
      ],
    },
    plugins: [
      // new BundleAnalyzerPlugin(),
      new CleanWebpackPlugin({
        cleanStaleWebpackAssets: false,
        cleanOnceBeforeBuildPatterns: [
          path.join(__dirname, 'stage/build/desktop')],
      }),
      new webpack.DefinePlugin({
        SIYUAN_VERSION: JSON.stringify(pkg.version),
        NODE_ENV: JSON.stringify(argv.mode),
      }),
      new MiniCssExtractPlugin({
        filename: 'base.[contenthash].css',
      }),
      new HtmlWebpackPlugin({
        inject: 'head',
        chunks: ['main'],
        filename: 'index.html',
        template: 'src/assets/template/desktop/index.tpl',
      }),
    ],
  }
}
