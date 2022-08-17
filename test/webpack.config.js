const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  mode: "development",
  entry: {
    index: "./index.ts",
    sw: "./sw.ts",
  },
  devServer: {
    static: "./dist",
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  output: {
    path: __dirname + "/dist",
    filename: "[name].js",
  },
  plugins: [new HtmlWebpackPlugin({excludeChunks: ["sw"]})],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js", ".d.ts"],
    fallback: {url: false},
  },
  devtool: "inline-source-map",
};
