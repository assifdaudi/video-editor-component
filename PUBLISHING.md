# Publishing Guide

This guide explains how to publish the `@assifdaudi/video-editor-lib` package to npm.

## Prerequisites

1. **npm account**: Create an account at [npmjs.com](https://www.npmjs.com/)
2. **Login**: Run `npm login` to authenticate
3. **Organization**: If using `@assifdaudi` scope, ensure you have access to that organization

## Pre-Publishing Checklist

- [ ] Update version in `projects/video-editor-lib/package.json`
- [ ] Update CHANGELOG.md (if you maintain one)
- [ ] Build the library: `npm run build:lib`
- [ ] Test the library in a fresh Angular project
- [ ] Verify all exports are correct
- [ ] Check that README.md is up to date

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features (backward compatible)
- **PATCH** (1.0.0 → 1.0.1): Bug fixes (backward compatible)

## Publishing Steps

### 1. Build the Library

```bash
npm run build:lib
```

This creates the distributable files in `dist/video-editor-lib/`.

### 2. Navigate to Dist Directory

```bash
cd dist/video-editor-lib
```

### 3. Publish to npm

**Dry run (test without publishing):**
```bash
npm publish --dry-run
```

**Publish public package:**
```bash
npm publish --access public
```

**Publish scoped package (if using @assifdaudi scope):**
```bash
npm publish --access public
```

### 4. Verify Publication

Check your package on npm:
```
https://www.npmjs.com/package/@assifdaudi/video-editor-lib
```

## Post-Publishing

1. **Tag the release** in git:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Update documentation** if needed

3. **Announce the release** (if applicable)

## Updating the Package

To publish an update:

1. Make your changes
2. Update version in `projects/video-editor-lib/package.json`
3. Build: `npm run build:lib`
4. Publish from `dist/video-editor-lib/`

## Troubleshooting

### "Package name already exists"

- Check if the package name is already taken
- Consider using a different name or scope
- If it's your package, you're trying to republish the same version - bump the version number

### "You do not have permission to publish"

- Ensure you're logged in: `npm whoami`
- Check organization permissions if using a scope
- Verify package name matches your npm username/org

### "Invalid package name"

- Package names must be lowercase
- Scoped packages must follow `@scope/package-name` format
- No special characters except hyphens and underscores

## Using the Published Package

After publishing, users can install it:

```bash
npm install @assifdaudi/video-editor-lib
```

Then import in their Angular project:

```typescript
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';
```

