/* eslint-disable @typescript-eslint/no-var-requires */
const HtmlWebpackPlugin = require("html-webpack-plugin");
const ESLintPlugin = require("eslint-webpack-plugin");
const nodeExternals = require("webpack-node-externals");
const path = require("path");
const argv = require("yargs").argv;

const lint = argv.linting;

const config = [
    {
        entry: './src/server/index.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'main.js',
        },
        externals: [nodeExternals()],
        devtool: "source-map",
        resolve: {
            extensions: ['.ts', '.tsx',],
            alias: {}
        },
        target: "node",
        node: {
            __dirname: false,
            __filename: false
        },
        module: {
            rules: [{
                test: /\.tsx?$/,
                exclude: [/lib/, /dist/],
                loader: "ts-loader"
            }]
        },
        plugins: []
    },
    {
        devtool: "source-map",
        entry: './src/client/index.tsx',
        module: {
            rules: [
                {
                    test: /\.(ts|tsx)?$/,
                    loader: "ts-loader",
                    exclude: /node_modules/
                },
            ]
        },
        target: "web",
        resolve: {
            extensions: ['.ts', '.js', '.tsx']
        },
        output: {
            filename: 'webChat/bundle.js'
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: "src/public/index.html",
                hash: true,
                filename: 'webChat/index.html'
            })
        ]
    }
]

if (lint !== false) {
    config[0].plugins.push(new ESLintPlugin({ extensions: ["ts", "tsx"], failOnError: false }));
    config[1].plugins.push(new ESLintPlugin({ extensions: ["ts", "tsx"], failOnError: false }));
}

module.exports = config;