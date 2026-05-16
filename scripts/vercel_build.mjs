import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function mkdirp(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyFile(src, dest) {
  await mkdirp(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(srcDir, destDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await mkdirp(destDir);

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(srcPath);
      await fs.symlink(linkTarget, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

function rootRedirectHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Study site</title>
  <meta http-equiv="refresh" content="0; url=/web/" />
  <script>location.replace('/web/');</script>
</head>
<body>
  <p>Redirecting to <a href="/web/">/web/</a>…</p>
</body>
</html>`;
}

async function main() {
  const webDir = path.join(ROOT, 'web');
  const generatedDir = path.join(ROOT, 'generated');
  const courseConfig = path.join(ROOT, 'course_config.json');

  if (!(await exists(webDir))) {
    throw new Error('Missing required folder: web/');
  }
  if (!(await exists(courseConfig))) {
    throw new Error('Missing required file: course_config.json');
  }
  if (!(await exists(generatedDir))) {
    throw new Error(
      'Missing required folder: generated/\n' +
        'Run `bash scripts/generate_all.sh` locally before deploying (or commit generated/ for Git-based deploys).'
    );
  }

  await rmrf(DIST);
  await mkdirp(DIST);

  // Root redirect so https://<project>.vercel.app/ lands on /web/.
  await fs.writeFile(path.join(DIST, 'index.html'), rootRedirectHtml(), 'utf8');

  // The site expects these exact relative paths.
  await copyDir(webDir, path.join(DIST, 'web'));
  await copyDir(generatedDir, path.join(DIST, 'generated'));
  await copyFile(courseConfig, path.join(DIST, 'course_config.json'));

  // Optional: expose vercel.json for debugging (harmless).
  const vercelJson = path.join(ROOT, 'vercel.json');
  if (await exists(vercelJson)) {
    await copyFile(vercelJson, path.join(DIST, 'vercel.json'));
  }

  console.log('Vercel build: dist/ prepared');
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
