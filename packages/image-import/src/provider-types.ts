export type ProviderImageResult = {
  mime: string;
  width: number;
  height: number;
};
export class ProviderImageError extends Error {
  constructor(readonly kind: "format" | "decode") {
    super(kind);
  }
}
