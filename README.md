# @rizumu/nai

> **n**pm **a**dd, **i**nteractive ✨

> Interactive CLI tools for managing packages and scripts ✨

A suite of interactive CLI commands that make dependency installation and script running easy — with first-class **catalog** support and automatic package manager detection.

<img height="500" alt="Ghostty 2026-03-11 01 32 41" src="https://github.com/user-attachments/assets/83d164f3-8a13-41f1-a453-23ffd81ed387" />

## 📦 Install

```bash
npm i -g @rizumu/nai
```

## 🚀 Commands

| Command | Description |
| ------- | ----------- |
| `nai`   | Install packages (interactive) |
| `nar`   | Run scripts (interactive) |

## nai — install packages

```bash
# Interactive mode — prompts for everything
# Press Enter twice to install all dependencies
nai

# Pass package names directly
nai react vue@^3.5 lodash

# Install as devDependencies
nai vitest -D

# Install as peerDependencies
nai react --peer

# Specify a catalog
nai zod -C prod
```

Run `nai --help` for all available options.

## nar — run scripts

```bash
# Interactive mode — fuzzy search and pick a script, including monorepo scripts
nar

# Run a script directly (like npm run)
nar dev

# Forward arguments to the script
nar dev --port 3000
```

In **monorepo** projects, `nar` lists scripts from all workspace packages with fuzzy search across script names and package names. Root scripts are listed first.

Run `nar --help` for all available options.

## 💡 Why nai?

Installing dependencies in modern projects is getting painful:

- Which package manager? `npm`, `pnpm`, `yarn`, `bun`?
- Remember the exact package name — no typos allowed
- `-D` or not? `--save-peer`?
- Monorepo? Which workspace package? (`-F`, `-w`, ...)
- Catalogs? Manually edit `pnpm-workspace.yaml` every time...

Too many flags. Too many files to touch. Too many things to remember.

`nai` solves this with a beautiful interactive UI that guides you through each step:

1. 🔍 **Auto-detect** your package manager
2. 📦 **Resolve versions** — reuse existing catalog entries or fetch latest from npm
3. 🗂️ **Pick a catalog** — or skip, or create a new one
4. 📁 **Select workspace packages** in monorepo
5. 🏷️ **Choose dep type** — `dependencies` / `devDependencies` / `peerDependencies`
6. ✅ **Review & confirm** — colorful summary before any file is changed
7. 🚀 **Install** — writes config files and runs install for you

## 🗂️ What is a Catalog?

Catalogs let you define dependency versions in one central place (e.g. `pnpm-workspace.yaml`) and reference them in `package.json` with `catalog:name`. This keeps versions consistent across a monorepo.

```yaml
# pnpm-workspace.yaml
catalogs:
  prod:
    react: ^19.0.0
    vue: ^3.5.0
```

```json
// package.json
{
  "dependencies": {
    "react": "catalog:prod"
  }
}
```

`nai` manages this for you — no manual file editing needed.

## 🛠️ Supported Package Managers

| Package Manager | Catalog Support          | Status                    |
| --------------- | ------------------------ | ------------------------- |
| pnpm            | ✅ `pnpm-workspace.yaml` | ✅ Supported              |
| yarn            | ✅ `.yarnrc.yml`         | ✅ Supported              |
| bun             | ✅ `package.json`        | ✅ Supported              |
| vlt             | ✅ `vlt.json`            | ✅ Supported              |
| npm             | ❌                       | ✅ Supported (no catalog) |

## 📄 License

[MIT](./LICENSE)
