const path = require("path");
const { PyodidePlugin } = require("@pyodide/webpack-plugin");

module.exports = {
  entry: "./lib/index.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "index.js",
    library: {
      name: "pyodide-worker-runner",
      type: "umd",
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [new PyodidePlugin()],
  resolve: {
    extensions: [".ts", ".js", ".d.ts"],
    fallback: {url: false},
  },
  devtool: "source-map",
  externals: {
    comlink: "comlink",
    "sync-message": "sync-message",
    comsync: "comsync",
    pyodide: "pyodide",
  },
};
