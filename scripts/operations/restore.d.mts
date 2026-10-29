export function validateRestore(
  url: string,
  confirm: string,
  developmentUrl?: string,
): Record<string, string>;
export function restore(options: {
  url: string;
  confirm: string;
  path: string;
  key: string;
  keyId: string;
  developmentUrl?: string;
}): Promise<void>;
