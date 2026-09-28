declare module "bun:test" {
  type TestCallback = () => unknown | Promise<unknown>;
  type Matcher = {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
  };
  type TestFunction = {
    (name: string, callback: TestCallback): void;
    each<T extends readonly unknown[]>(
      cases: readonly T[],
    ): (name: string, callback: (...values: T) => unknown) => void;
  };

  export const test: TestFunction;
  export const it: TestFunction;
  export function describe(name: string, callback: TestCallback): void;
  export function expect(value: unknown): Matcher;
}
