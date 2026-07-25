declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    IMAGES: {
      input(stream: ReadableStream): {
        transform(options: Record<string, unknown>): {
          output(options: {
            format: string;
            quality: number;
          }): Promise<{ response(): Response }>;
        };
      };
    };
  }
}
