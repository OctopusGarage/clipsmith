# Release Clipsmith

This project currently distributes from GitHub. Users install the CLI with
`uv tool install git+https://github.com/OctopusGarage/clipsmith.git`, then run
`clipsmith install --all` to install bundled Claude Code and Codex skills.

## Preflight

```bash
git status -sb
git pull --ff-only
./script/check-health.sh
gitleaks git . --config .gitleaks.toml --redact -v --platform github
```

The working tree should be clean before tagging.

## Version

Update `pyproject.toml`:

```toml
[project]
version = "0.x.y"
```

Commit the version bump:

```bash
git add pyproject.toml uv.lock
git commit -m "chore: release v0.x.y"
```

## Tag And Publish GitHub Release

```bash
git tag -a v0.x.y -m "v0.x.y"
git push origin main
git push origin v0.x.y
gh release create v0.x.y --title "v0.x.y" --notes "See README.md and INSTALL.md for installation."
```

## Future PyPI Release

The package metadata is ready for Python packaging, but this project is not yet
published to PyPI. If PyPI distribution becomes necessary, add a trusted
publisher workflow and update `INSTALL.md` with:

```bash
uv tool install clipsmith
```
