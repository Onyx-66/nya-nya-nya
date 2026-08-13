import baseConfig from "./vite.config";

export default async () => {
  const base = typeof baseConfig === "function" ? await baseConfig() : baseConfig;
  return {
    ...base,
    server: {
      ...base.server,
      allowedHosts: true,
    },
  };
};
