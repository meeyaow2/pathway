# Deployment (GitHub Pages)

Pathway is a static site. `.github/workflows/pages.yml` runs on every pull request and on every push to `main`:

| Event | test | build (upload `public/`) | deploy |
|---|---|---|---|
| Pull request | ✅ unit tests, syntax check, check that `public/` contains the app | — | — |
| Push to `main` | ✅ | ✅ stamps the commit ID into `sw.js`, uploads `public/` | ✅ publishes to https://meeyaow2.github.io/pathway/ |

Production is whatever is on `main`. Pull requests are never published.

## One-time repository setting
In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. The live site serving `public/` from the workflow artifact confirms it's already set. If it's ever switched back to *Deploy from a branch*, GitHub also runs its own "pages build and deployment" job on every push, and serves the repository root (the README and the redirect `index.html`) instead of the app.

## The "No artifacts named github-pages were found" failure

**Evidence:** runs 2 and 9 on `main`.
- `upload-pages-artifact` reported *"Artifact github-pages has been successfully uploaded"*.
- **0.3 s later, in the same job**, `deploy-pages` reported *"Found 0 artifact(s)"*.
- Run 5 used the identical workflow and succeeded.

**Cause:** an intermittent timing problem. The artifact wasn't yet visible to the deployment API when `deploy-pages` queried it in the same job, and the action's own message suggests re-running. Run 2 also overlapped with the "Deploy from a branch" job (the Pages source was being switched at the time), and runs 6–8 were cancelled because five commits were pushed within seconds.

**Fixes in the workflow:**
1. **Separate `build` and `deploy` jobs**, as in GitHub's official Pages template. The deploy job starts after the build job has finished and its artifact is registered.
2. **Separate concurrency:** each branch has its own group, superseded PR runs are cancelled, and production deploys use a dedicated `pages-production` group that is never cancelled mid-deploy. Previously, PR test runs shared the `pages` group with production.
3. **Least privilege:** only the deploy job has `pages: write` / `id-token: write`.
4. **Node 24 versions** of `checkout` and `setup-node` (replacing the deprecated Node 20 versions), and `upload-pages-artifact@v4`.

**If it ever happens again:** open the failed run and choose **Re-run failed jobs**. The build job doesn't need to run again. GitHub Pages incidents are listed at githubstatus.com.

## Service worker and updates
- `sw.js` is registered from `/pathway/` with `updateViaCache: 'none'`, so its scope is `/pathway/` and the browser always checks the network for a new `sw.js`.
- Each deploy stamps a new build ID into `sw.js`. The new worker installs immediately and deletes the old app cache.
- **HTML, JS and CSS are network-first**, so a visitor never gets new HTML with old JavaScript. Cached copies are used only offline, or when the network takes more than 4 s.
- **Emergency off switch:** delete `public/sw.js` and deploy. Browsers unregister a worker whose script returns 404.
