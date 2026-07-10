/** Hand-written declarations for the JS gallery server (serve.mjs). */
export interface GalleryHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}
export function startGallery(opts?: { port?: number }): Promise<GalleryHandle>;
