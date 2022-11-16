const path = require('path')
const webpack = require('webpack')
const pkg = require('./package.json')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
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
      publicPath: "",
      filename: '[name].js',
      path: path.resolve(__dirname, 'stage/build/export'),
      libraryTarget: 'umd',
      library: 'Protyle',
      libraryExport: 'default',
    },
    entry: {
      'protyle-method': './src/protyle/method.ts',
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
      extensions: ['.ts', '.js', '.scss'],
    },
    module: {
      rules: [
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
                MOBILE: true,
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
      ],
    },
    plugins: [
      // new BundleAnalyzerPlugin(),
      new CleanWebpackPlugin({
        cleanOnceBeforeBuildPatterns: [
          path.join(__dirname, 'stage/build/export')],
      }),
      new webpack.DefinePlugin({
        NODE_ENV: JSON.stringify(argv.mode),
        SIYUAN_VERSION: JSON.stringify(pkg.version),
      }),
      new MiniCssExtractPlugin({
        filename: 'base.css',
      }),
    ],
  }
}
