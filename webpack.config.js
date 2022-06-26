const path = require("path");

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
  resolve: {
    extensions: [".ts", ".js", ".d.ts"],
  },
  devtool: "source-map",
  externals: {
    comlink: "comlink",
    "sync-message": "sync-message",
    comsync: "comsync",
    pyodide: "pyodide",
  },
};
