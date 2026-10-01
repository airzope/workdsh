# White-label builds

[中文](white-label.md)

A brand directory decides WorkDSH Desktop's product name, icons, and identifiers **at build time**. The same source and pinned DSH version can produce installers for different brands; an installed application reads no external brand configuration.

## Brand directory

The default brand is `dsh-plugin-desktop/branding/workdsh/`. Copy that directory to start a new brand:

```text
dsh-plugin-desktop/branding/acme/
├── brand.json
├── logo.png     # square PNG, at least 512 pixels, 1024 recommended
└── mark.svg     # optional simplified mark for small icons, the tray, the sidebar and the chat start page
```

Example `brand.json`:

```json
{
  "name": "智办助手",
  "fileName": "AcmeDesk",
  "executableName": "acmedesk",
  "appId": "com.acme.desk",
  "publisher": "Acme Ltd",
  "support": "https://acme.example/support",
  "summary": "Acme office workspace",
  "description": "Acme desktop workspace",
  "dataDirectory": "AcmeDesk",
  "logo": "logo.png",
  "mark": "mark.svg",
  "color": "#148C5A"
}
```

| Field | Purpose | Rules |
| --- | --- | --- |
| `name` | Display name: window title, shortcuts, Start menu, uninstall entry, macOS display name, Linux desktop entry, sidebar brand, and page title | Any language, up to 128 characters |
| `fileName` | App bundle, executable, install directory, and installer file names | Letters, digits, `.`, `_`, `-`; no spaces |
| `executableName` | Linux command and Debian package name | Lowercase letters, digits, `.`, `+`, `-` |
| `appId` | Application identifier; a different one installs side by side | Reverse DNS, such as `com.acme.desk` |
| `publisher`, `support` | Linux maintainer field, copyright, and author | `support` is an http(s) address |
| `summary`, `description` | Linux summary and application description | One line |
| `dataDirectory` | User-data folder name under the system application-data directory | Same rules as `fileName`; defaults to `fileName` |
| `logo` | Source of the application icons | Square PNG, at least 512 pixels |
| `mark` | Simplified mark | SVG with colors in `fill`/`stroke` attributes, no `<style>` or `style` |
| `color` | Color of the single-color tray icons | `#RRGGBB`; without it the mark keeps its colors |

Without a `mark`, small icons, the sidebar and the chat start page use the `logo`, and the tray template icon uses the logo's silhouette.

## Build

At the repository root, set `WORKDSH_BRAND` to the brand directory or its `brand.json` (relative paths start at the repository root), then build for the platform as usual:

```sh
export WORKDSH_BRAND=dsh-plugin-desktop/branding/acme
corepack yarn build
corepack yarn workspace dsh-plugin-desktop dist:linux   # or dist:win, dist:mac-smoke, dist:win7
```

`corepack yarn build` runs `scripts/generate-brand.ts`, which writes every icon, tray bitmap, the mark, and the brand fields to `dsh-plugin-desktop/build/brand/`. Packaging and verification scripts read that generated brand instead of the environment, so one build is packaged under one brand. Keep the same `WORKDSH_BRAND` for the whole build and packaging run.

You can also run the CI workflow manually in GitHub Actions and enter a committed brand directory in its `brand` input to get test installers for that brand. Pushes and release tags always build WorkDSH.

## What the brand covers

- Installers and applications: file names of the Windows installer, portable archive, and Windows 7 offline installer; `AcmeDesk.exe`; the install directory; desktop and Start menu shortcuts; the uninstall entry's name and icon; `AcmeDesk.app` with its Dock icon and display name on macOS; `/opt/AcmeDesk`, the `acmedesk` command, the Debian package name, and the desktop entry on Linux.
- At run time: window title and icon, user-data directory, sidebar brand name and mark, the mark on the chat start page, page title, the product name in the browser prompt, and the creator of exported XLSX and PDF files.
- Web deployments: the Host reads `WORKDSH_BRAND_NAME` and `WORKDSH_BRAND_MARK` (path to an SVG or PNG mark, at most 256 KiB) and serves them to the interface at `/api/workdsh-brand`. The Desktop carrier sets both variables.

## Limitations

- Built-in skills, experts, agent prompts, and the diagnostics page keep the WorkDSH name; the DeepSeek Harness upstream interface is not modified.
- After changing `appId` or `dataDirectory`, the application does not read the previous brand's user data.
- White-label packages are unsigned as well; see the [FAQ](faq.en.md) for installation. The Windows 7 offline installer bundles VxKex NEXT, so confirm redistribution permission before shipping it, and confirm your rights to any third-party name and mark.
- The repository's official releases build only the WorkDSH brand from `main`; white-label builds are for your own distribution.
