declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: Fetcher;
    NEXT_PUBLIC_SITE_URL?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_CONNECT_ENABLED?: string;
    TEAM_PAYOUT_CURRENCY?: string;
    TEAM_PAYOUT_MINOR_PER_ONYX?: string;
    AD_REWARD_PROVIDER_URL?: string;
    AD_REWARD_WEBHOOK_SECRET?: string;
    AD_UNLOCK_HOURS?: string;
    EMAIL_PROVIDER?: string;
    EMAIL_FROM?: string;
    EMAIL_API_KEY?: string;
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
