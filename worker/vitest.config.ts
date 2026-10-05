import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      // Only this package's own suite. Without an explicit include, Vitest
      // also picks up any *.test.ts sitting under the gitignored
      // `private-data/` working directory, so what `pnpm check` ran depended
      // on which local analysis artifacts happened to be present and could
      // not be reproduced from a clean checkout.
      include: ['test/**/*.test.ts'],
      // Converter tests use Node's built-in test runner (`pnpm run
      // test:converter`), not Vitest/Workers — ExcelJS has no business
      // running inside the Workers pool.
      exclude: [...configDefaults.exclude, 'test/converter/**'],
    },
  };
});
