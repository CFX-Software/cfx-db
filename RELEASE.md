# Release Process

This document explains how to create a new release of CFX-DB.

## 🚀 Creating a Release

Releases are **fully automated** via GitHub Actions. Just create and push a tag:

```bash
# Make sure you're on main branch
git checkout main

# Merge latest dev changes
git merge dev

# Create a version tag (semantic versioning)
git tag v1.0.0

# Push tag to private repo
git push private v1.0.0
```

## 📦 What Happens Automatically:

1. **GitHub Actions Triggered** - Workflow runs on private repo
2. **Clean Build** - Removes dev artifacts (node_modules, .env, snapshots)
3. **TypeScript Build** - Compiles all TypeScript to JavaScript
4. **Generate Changelog** - Auto-generates changelog from commits
5. **Create Release (Private)** - Creates GitHub Release on private repo
6. **Deploy to Public** - Pushes clean code to public repo
7. **Create Release (Public)** - Creates GitHub Release on public repo
8. **Tag Public Repo** - Tags public repo with same version

## 📋 Semantic Versioning

Follow semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR** (`v2.0.0`) - Breaking changes (API changes, removed features)
- **MINOR** (`v1.1.0`) - New features (backward compatible)
- **PATCH** (`v1.0.1`) - Bug fixes (backward compatible)

### Examples:

```bash
# First public release
git tag v1.0.0

# Added new feature (query caching improvements)
git tag v1.1.0

# Fixed bug (transaction error handling)
git tag v1.0.1

# Breaking change (changed DB.select API)
git tag v2.0.0
```

## ✅ Pre-Release Checklist

Before creating a release tag:

- [ ] All tests passing
- [ ] Updated `DOCS.md` if needed
- [ ] Updated `README.md` if needed
- [ ] Version bump in `fxmanifest.lua`
- [ ] Version bump in `package.json`
- [ ] Merged `dev` → `main`
- [ ] No sensitive data in commits

## 🔄 Hotfix Workflow

For urgent bug fixes:

```bash
# Create hotfix branch from main
git checkout main
git checkout -b hotfix/critical-bug

# Fix the bug
# ... make changes ...

# Commit and merge to main
git commit -m "fix: critical bug in transaction handler"
git checkout main
git merge hotfix/critical-bug

# Create patch release
git tag v1.0.2
git push private v1.0.2

# Merge back to dev
git checkout dev
git merge main
```

## 📝 Release Notes Best Practices

Write good commit messages - they become your changelog!

**Good:**
```
feat: add query caching with LRU eviction
fix: prevent transaction deadlocks
docs: update README with production features
```

**Bad:**
```
update
fix stuff
wip
```

## 🎯 Release Schedule

**Recommended:**
- **Patch releases** (bug fixes) - As needed
- **Minor releases** (new features) - Every 2-4 weeks
- **Major releases** (breaking changes) - Every 3-6 months

## 🔗 Useful Commands

```bash
# View all tags
git tag -l

# View latest tag
git describe --tags --abbrev=0

# Delete tag (if mistake)
git tag -d v1.0.0
git push private :refs/tags/v1.0.0

# View commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

## 🐛 Troubleshooting

**Workflow failed?**
- Check GitHub Actions logs: https://github.com/CFX-Software/cfx-db-private/actions
- Ensure `DEPLOY_TOKEN` secret is set correctly
- Verify tag format matches `v*.*.*`

**Tag pushed but nothing happened?**
- Workflow only triggers on tags matching `v*.*.*`
- Check tag format: `git tag -l`

**Public repo not updated?**
- Check workflow logs for deployment step errors
- Verify `DEPLOY_TOKEN` has `repo` permissions
