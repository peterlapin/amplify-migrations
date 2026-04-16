import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'runtime/runnerHandler': 'src/runtime/runnerHandler.ts',
  },
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  clean: true,
  target: 'node20',
  // esbuild is required at synth time for the default bundler path
  external: ['aws-cdk-lib', 'constructs', 'esbuild'],
});
