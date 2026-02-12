import * as esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Ensure dist directory exists
const distDir = join(rootDir, 'dist', 'server');
if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
}

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const buildOptions = {
    entryPoints: [join(rootDir, 'server', 'main.ts')],
    bundle: true,
    outfile: join(distDir, 'main.js'),
    platform: 'node',
    target: 'node22',
    format: 'iife',
    sourcemap: true,
    minify: false,
    keepNames: true,
    external: [
        // FiveM globals are provided at runtime
    ],
    define: {
        'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
    },
    logLevel: 'info',
};

async function build() {
    try {
        if (isWatch) {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
            console.log('[cfx-db] Watching for changes...');
        } else {
            const result = await esbuild.build(buildOptions);
            console.log('[cfx-db] Build complete!');
            if (result.errors.length > 0) {
                console.error('Build errors:', result.errors);
                process.exit(1);
            }

            // Touch .yarn.installed to prevent FiveM yarn builder from running
            const { writeFileSync } = await import('fs');
            const yarnInstalledPath = join(rootDir, '.yarn.installed');
            writeFileSync(yarnInstalledPath, '');
            console.log('[cfx-db] Updated .yarn.installed marker');
        }
    } catch (error) {
        console.error('[cfx-db] Build failed:', error);
        process.exit(1);
    }
}

build();
