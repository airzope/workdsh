# Third-party notices

WorkDSH Desktop contains Electron and a pinned DeepSeek Harness runtime Profile.
The official DeepSeek Harness version is recorded in the repository's
[`upstream.json`](../upstream.json); the installed app's `workdsh-runtime` directory
contains the actual Profile package manifests and applicable license files.

DeepSeek Harness is distributed under the MIT License. Its version-specific
third-party notices are maintained by the upstream project:
<https://github.com/deepseek-ai/deepseek-harness/blob/master/THIRD_PARTY_NOTICES.md>.
WorkDSH bundles and their dependencies retain their own license terms, which
must be checked from the exact release artifacts used for an installer.

The Desktop Profile bundles two separate third-party plugins:

- [`@cocofhu/skillhub`](https://www.npmjs.com/package/@cocofhu/skillhub)
  version 0.2.16 for SkillHub integration. Source and MIT license:
  <https://github.com/cocofhu/skillhub>.
- [`dshmarket`](https://www.npmjs.com/package/dshmarket) version 1.66.1 for
  DSH community plugin discovery. Source and MIT license:
  <https://github.com/dsh-market/dsh-market>.

The SkillHub catalog and API are maintained separately by
[`Tencent/skillhub`](https://github.com/Tencent/skillhub). The plugin catalog
used by dshmarket is maintained by
[`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

The Windows 7 x64 offline installer additionally carries two unmodified
installers, which it runs only on Windows 7 when the component is missing or
older:

- [VxKex NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 1.2.3.2463
  (`KexSetup_Release_1_2_3_2463.exe`, SHA-256
  `757fb01cf38daa38c6e2db542169554117c533921e5edc119a567bfbe18566af`). The
  upstream repository publishes no license; redistributing it relies on
  permission from its authors, which the WorkDSH maintainers are responsible
  for holding. VxKex NEXT contains DLLs taken from newer Windows releases and
  remains subject to its authors' and Microsoft's terms.
- The Microsoft Visual C++ 2015-2022 Redistributable (x64) 14.44.35211
  (`VC_redist.x64.exe`, SHA-256
  `cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b`),
  distributed under the Microsoft Software License Terms for Visual Studio.

This file intentionally does not freeze a dependency inventory from an older
DSH release. Check the bundled Profile and its license files when publishing.
