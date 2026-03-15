declare module "pdfjs-dist/legacy/build/pdf";
declare module "pdfjs-dist/legacy/build/pdf.worker?url";
declare module "mammoth/mammoth.browser";

type GtagConfigParams = Record<string, unknown>;

interface Gtag {
  (command: "js", date: Date): void;
  (command: "config", targetId: string, config?: GtagConfigParams): void;
  (command: "event", eventName: string, eventParams?: GtagConfigParams): void;
}

declare global {
  interface Window {
    dataLayer: IArguments[];
    gtag?: Gtag;
  }
}

export {};
