// Neither `stylis` nor `stylis-plugin-rtl` ship their own TypeScript
// declarations in the versions pinned in apps/web/package.json (stylis's
// package.json doesn't point `types`/`typings` at its bundled .d.ts in a
// way this project's moduleResolution picks up, and stylis-plugin-rtl
// ships no types at all). Both are only used to configure `createCache`'s
// `stylisPlugins` option in main.tsx — a `Plugin` type from stylis would
// be more precise, but declaring them as untyped modules here is enough
// to satisfy `import { prefixer } from 'stylis'` / `import rtlPlugin from
// 'stylis-plugin-rtl'` without pulling in an extra @types package.
declare module 'stylis' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const prefixer: any;
}

declare module 'stylis-plugin-rtl' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rtlPlugin: any;
  export default rtlPlugin;
}
