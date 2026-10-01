# Agent Note: Settings and bundle choices survive launches in the runtime Profile

Status: implemented

English | [中文](2026-10-01-runtime-profile-patch-settings.zh.md)

## Decision

DSH saves every Settings change in the active Profile's `cordis.patch.yml`: the default model, provider routes, a Settings page's fields and an acknowledged notice. In WorkDSH Desktop that same file also carries the WorkDSH composition, which the carrier installs from the bundled Profile. Up to Desktop 2.0.6-alpha.3 the carrier copied the bundled file over it at every launch, so every Settings change was lost at the next start.

The carrier now owns only the bundled part of the file (`src/profile-patch.ts`):

- It records the bundled file it installed as `.workdsh-bundled-cordis.patch.yml` beside the patch.
- While the bundled file is unchanged, it leaves the patch alone.
- When the bundled file changes and the user's patch is untouched, it installs the new one.
- When both changed, it starts from the new bundled file and appends the user's own rows: top-level rows that name an entry by id, insert nothing, and are neither rows of the new bundled file nor unchanged rows of the previous one. These are the rows DSH's configuration editor appends for entries that lower layers declare. The previous patch is kept as `cordis.patch.yml.before-update`.
- A patch it cannot split into top-level block rows is replaced by the bundled file, with the same backup.

Profiles from earlier releases have no record of the bundled file. The first launch of a new build merges them the same way, so the Settings saved in the last session before the update survive.

The Plugins page turns an optional bundle, such as Voice Input, on or off by editing `dsh.profile.bundles` in the Profile's `package.json`, which the carrier also copied over at every launch. `src/profile-manifest.ts` treats it the same way. It records the bundled file as `.workdsh-bundled-package.json` and leaves the Profile's file alone while the bundled one is unchanged. On an update it takes the new bundled file, adds the bundles the user added and drops the ones the user removed. Without a record, it keeps additions and removes nothing.

## Constraints

- A user change inside a row the bundled file owns, such as the configuration of a plugin the WorkDSH Profile inserts, is kept until the next update of the bundled file and then replaced; the backup keeps it.
- DSH warns, and does not fail, when a carried row names an entry that a newer composition no longer has.
- The split is textual, so comments and `!!js` expressions in carried rows are kept exactly. It accepts block-style lists and an empty `[]` list only.

## Verification

`tests/profile-patch.spec.ts` and `tests/profile-manifest.spec.ts` cover the split, the merge with and without a record, installation, unchanged launches, updates and replacement of an unreadable file. With the staged Profile, a headless run acknowledged the welcome notice and chose a local default model; after a restart the patch was reported unchanged, the notice stayed acknowledged and the default stayed. Merging the alpha.16 bundled patch with a patch DSH had rewritten kept the notice acknowledgement row. Voice Input turned on from the Plugins page stayed on after a restart, and its microphone transcribed through the bundled SenseVoice weights.
