# ESLint Configuration Guide

This project uses ESLint with separate configurations for the Angular frontend and Node.js backend.

## Quick Commands

### Lint Everything
```bash
npm run lint:all        # Lint both client and server
```

### Client (Angular)
```bash
npm run lint            # Lint Angular app
npm run lint:fix        # Auto-fix Angular issues
```

### Server (Node.js)
```bash
npm run lint:server     # Lint backend server
npm run lint:server:fix # Auto-fix server issues
```

## Configuration Files

### Root: `eslint.config.mjs`
**Applies to:** Angular frontend (`src/**/*.ts`, `src/**/*.html`)

**Rules:**
- ✅ TypeScript recommended + stylistic rules
- ✅ Angular-specific rules (component selectors, etc.)
- ✅ Angular template rules with accessibility checks
- ✅ Explicit return types required
- ✅ Member ordering enforced (public → protected → private)
- ✅ Modern control flow syntax (@if, @for)
- ⚠️ `any` types as warnings
- ⚠️ Array type preference as warnings

**Ignores:** `server/`, `dist/`, `node_modules/`, `.angular/`

### Server: `server/eslint.config.mjs`
**Applies to:** Node.js backend (`server/src/**/*.ts`)

**Rules:**
- ✅ TypeScript recommended + stylistic rules
- ✅ Explicit return types required
- ✅ Prefer interfaces over types
- ✅ Allows empty arrow functions (Express handlers)
- ⚠️ `any` types as warnings
- ⚠️ Array type preference as warnings
- ❌ No Angular-specific rules

**Ignores:** `dist/`, `output/`, `node_modules/`

## Current Status

### ✅ Client (Angular Frontend)
```
Linting "video-editor"...

All files pass linting.
```

**Files linted:**
- `src/app/**/*.ts` (TypeScript components, services)
- `src/app/**/*.html` (Angular templates)

**Output:** Angular CLI provides a summary message

### ✅ Server (Node.js Backend)
```
✓ All server files pass linting.
```

**Files linted:**
- `server/src/**/*.ts` (Express API, FFmpeg logic)

**Output:** ESLint is silent by default, but a success message is added via npm script

## Enforced Code Standards

### 1. Explicit Return Types ✅
Every function must declare its return type:

```typescript
// ❌ Bad
function getData() {
  return data;
}

// ✅ Good
function getData(): DataType {
  return data;
}
```

### 2. Member Ordering (Frontend Only) ✅
Class members must follow this order:

1. **ViewChild decorators**
2. **Private fields** (dependencies like injected services)
3. **Protected fields** (used in template)
4. **More private fields**
5. **Constructor**
6. **Lifecycle hooks** (ngOnInit, ngOnDestroy, etc.)
7. **Protected methods** (called from template)
8. **Private methods** (internal helpers)

```typescript
export class MyComponent {
  @ViewChild('el') private el!: ElementRef;
  
  private service = inject(MyService);
  
  protected data = signal<string[]>([]);
  
  constructor() { }
  
  ngOnInit(): void { }
  
  protected handleClick(): void { }
  
  private helperMethod(): void { }
}
```

### 3. Unused Variables ✅
Variables must be used or prefixed with `_`:

```typescript
// ❌ Bad
function process(data, unused) {
  return data;
}

// ✅ Good
function process(data, _unused) {
  return data;
}
```

### 4. No Explicit `any` ⚠️
Use proper types instead of `any` (warning, not error):

```typescript
// ⚠️ Warning
const data: any = getData();

// ✅ Better
interface DataType { id: number; name: string }
const data: DataType = getData();
```

### 5. Array Type Style ⚠️
Prefer `T[]` over `Array<T>` (warning, not error):

```typescript
// ⚠️ Warning
const items: Array<string> = [];

// ✅ Preferred
const items: string[] = [];
```

## VSCode Integration

The project includes `.vscode/settings.json` with:
- ESLint auto-fix on save
- Validation for TypeScript and HTML
- Flat config support (ESLint 9+)

## CI/CD Integration

Add to your CI pipeline:

```yaml
# Example GitHub Actions
- name: Lint Frontend
  run: npm run lint

- name: Lint Backend  
  run: npm run lint:server

# Or lint everything
- name: Lint All
  run: npm run lint:all
```

## Troubleshooting

### "Config (unnamed): Key 'processor'"
Make sure you're using ESLint 9+ with flat config format.

### "Property 'X' is used before its initialization"
Fields with dependencies must be declared in order. Use `/* eslint-disable */` blocks if needed.

### Server lint not working
Make sure ESLint is installed in the server directory:
```bash
cd server
npm install
```

## Package Versions

- **ESLint**: 9.x (flat config)
- **typescript-eslint**: Latest
- **angular-eslint**: Latest (frontend only)

## Learn More

- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files)
- [typescript-eslint](https://typescript-eslint.io/)
- [angular-eslint](https://github.com/angular-eslint/angular-eslint)

