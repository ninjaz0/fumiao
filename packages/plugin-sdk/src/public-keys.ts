export const publicKeys = (value: Record<string, any>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]),
  );
