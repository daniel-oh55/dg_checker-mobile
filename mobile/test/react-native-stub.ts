/**
 * Minimal stand-in for `react-native` so the presentation modules can be
 * exercised in plain Node. `theme.ts` pulls in `Platform` for font selection,
 * which would otherwise drag the whole native runtime into the test process.
 *
 * Only the surface the presentation layer actually touches is modelled; this
 * file is test scaffolding and is never bundled into the app.
 */
export const Platform = {
  OS: 'ios' as const,
  select<T>(options: { ios?: T; android?: T; native?: T; default?: T }): T | undefined {
    return options.ios ?? options.native ?? options.default;
  },
};
