const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
// styles
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
// js
const TerserPlugin = require('terser-webpack-plugin');

module.exports = merge(common, {
    mode: 'production',
    devtool: false,
    module: {
        rules: [
            {
                test: /\.m?js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                },
            },
            {
                test: /\.css$/i,
                use: [
                    MiniCssExtractPlugin.loader,
                    'css-loader',
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: ['autoprefixer'],
                            },
                        },
                    },
                ],
            },
            {
                test: /\.s[ac]ss$/i,
                use: [
                    MiniCssExtractPlugin.loader,
                    'css-loader',
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: ['autoprefixer'],
                            },
                        },
                    },
                    {
                        loader: 'sass-loader',
                        options: {
                            // sass-loader 13 використовує застарілий JS API Sass — ховаємо це попередження
                            sassOptions: { silenceDeprecations: ['legacy-js-api'] },
                        },
                    },
                ],
            },
        ],
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                parallel: true,
            }),
            new CssMinimizerPlugin({
                parallel: true,
            }),
        ],
        splitChunks: {
            chunks: 'all',
            name: 'shared',
            minSize: 10000,
        },
    },
    plugins: [
        new MiniCssExtractPlugin({
            filename: 'styles/[name].[contenthash].css',
        }),
    ],
});
