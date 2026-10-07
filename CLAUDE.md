# Hochdeutsch-Fixer (Firefox)

This repo owns the logic shared with the Chromium port,
`AuroraNoUnderscores/hochdeutsch-fixer-chromium`. The two repos ship together:

- **The same version, always.** Every change, here or there, is released in both
  repos with the same version in both `manifest.json` files, even when only one
  side's files changed.
- **Bug fixes bump the patch** (3.6.0 → 3.6.1). The minor version goes up only
  for a new feature, and only when the owner asks for it.
- **Shared files are changed here first** (the list is in the Chromium repo's
  `sync.sh`), then copied there with `./sync.sh` in the same change.
- **One branch, one PR per repo,** with the same branch name, opened together,
  each linking to the other, and merged together.
- **Before pushing, run `tools/check_sync.sh` in the Chromium repo.** It must
  say "in step".
