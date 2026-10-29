export function backup(options: {
  url: string;
  path: string;
  key: string;
  keyId: string;
}): Promise<Record<string, unknown>>;
