const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--prod');

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy static files to dist
function copyStaticFiles() {
  // Copy manifest.json
  fs.copyFileSync(
    path.join(__dirname, 'manifest.json'),
    path.join(distDir, 'manifest.json')
  );

  // Copy popup HTML and CSS
  const popupDir = path.join(distDir, 'popup');
  if (!fs.existsSync(popupDir)) {
    fs.mkdirSync(popupDir, { recursive: true });
  }
  fs.copyFileSync(
    path.join(__dirname, 'src', 'popup', 'popup.html'),
    path.join(popupDir, 'popup.html')
  );
  fs.copyFileSync(
    path.join(__dirname, 'src', 'popup', 'popup.css'),
    path.join(popupDir, 'popup.css')
  );

  // Copy pdf.js worker
  const pdfWorkerSrc = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
  if (fs.existsSync(pdfWorkerSrc)) {
    fs.copyFileSync(pdfWorkerSrc, path.join(distDir, 'pdf.worker.min.mjs'));
  } else {
    console.warn('Warning: pdf.worker.min.mjs not found. Run npm install first.');
  }

  // Copy assets (icons)
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  const srcAssetsDir = path.join(__dirname, 'assets');
  if (fs.existsSync(srcAssetsDir)) {
    fs.readdirSync(srcAssetsDir).forEach((file) => {
      fs.copyFileSync(
        path.join(srcAssetsDir, file),
        path.join(assetsDir, file)
      );
    });
  }

  console.log('Static files copied to dist/');
}

// Load .env file if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

// Build configuration
const buildOptions = {
  entryPoints: [
    'src/background.ts',
    'src/popup/popup.ts',
  ],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome100',
  minify: isProd,
  sourcemap: !isProd,
  logLevel: 'info',
  // Replace process.env.* with actual values at build time
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
  },
};

async function build() {
  try {
    if (isWatch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');

      // Initial copy of static files
      copyStaticFiles();

      // Watch for static file changes
      const chokidar = require('chokidar');
      chokidar
        .watch(['manifest.json', 'src/**/*.html', 'src/**/*.css', 'assets/**/*'], {
          ignoreInitial: true,
        })
        .on('all', () => {
          copyStaticFiles();
        });
    } else {
      // One-time build
      await esbuild.build(buildOptions);
      copyStaticFiles();
      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
