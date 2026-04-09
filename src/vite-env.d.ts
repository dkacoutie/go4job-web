/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PAYSTACK_PUBLIC_KEY?: string;
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_JOBRADAR_FEED_BACKEND_SHADOW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "pdfjs-dist/legacy/build/pdf";
declare module "pdfjs-dist/legacy/build/pdf.worker?url";
declare module "mammoth/mammoth.browser";
