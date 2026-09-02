module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Lode",
    ignore: [/[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+[\\/](?:fixtures?|tests?)(?:[\\/]|$)/iu],
    name: "Lode",
    overwrite: true,
    prune: true,
  },
  rebuildConfig: {
    onlyModules: ["better-sqlite3"],
  },
  makers: [],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
  ],
};
