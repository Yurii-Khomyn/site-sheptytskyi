const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    // clean у dev-сервері після перезбирання стирає картинки з HTML-шаблону — вимикаємо (у prod лишається)
    output: {
        clean: false,
    },
    devServer: {
        static: './dist',
        hot: true,
        port: 3000,
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.s[ac]ss$/i,
                use: [
                    'style-loader',
                    'css-loader',
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
});
