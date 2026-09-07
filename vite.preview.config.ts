import baseConfig from "./vite.config";

const previewConfig = async () => {
  const base = typeof baseConfig === "function" ? await baseConfig({ command: "serve", mode: "development", isSsrBuild: false }) : baseConfig;
  return {
    ...base,
    server: {
      ...base.server,
      allowedHosts: true,
    },
  };
};

export default previewConfig;
