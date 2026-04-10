---
name: add-release-note
description: Add a new release note entry. Keeps the client data file and the docs MDX page in sync, and bumps the version so the in-game modal re-appears for all players.
---

# Add Release Note

Two files must **always** be updated together:

| File                               | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| `client/src/data/release-notes.ts` | Structured data rendered in the in-game modal |
| `docs/pages/release-notes.mdx`     | Public documentation page                     |

## Steps

### 1. Add the entry in the data file

Open `client/src/data/release-notes.ts` and insert a new object **at the top** of the `RELEASE_NOTES` array:

```ts
{
  date: "April 11, 2026",          // human-readable date
  sections: [
    {
      title: "Features",            // or "Bug Fixes"
      items: [
        "Description of the change.",
      ],
    },
  ],
},
```

Every item must be a bullet point string in the `items` array. Group items under `"Features"` or `"Bug Fixes"` sections.

### 2. Bump the version

In the same file, update `RELEASE_NOTES_VERSION` to match the new entry date in ISO format:

```ts
export const RELEASE_NOTES_VERSION = "2026-04-11";
```

This is what triggers the modal to re-appear. The `useReleaseNotes` hook compares this value against the version stored in the player's localStorage (`nums-release-notes-version`). If they differ, the modal is shown.

### 3. Mirror in the docs

Open `docs/pages/release-notes.mdx` and add a matching section **at the top**, after the `---` separator:

```mdx
## April 11, 2026

### Features

- Description of the change.

---
```

Use the same section headings (`### Features`, `### Bug Fixes`) and the same bullet point text as in the data file.

## Checklist

- [ ] New entry added at the top of `RELEASE_NOTES` array
- [ ] `RELEASE_NOTES_VERSION` bumped to new date
- [ ] Matching entry added at the top of `docs/pages/release-notes.mdx`
- [ ] Bullet point text is identical in both files
- [ ] `pnpm run type:check` passes in `client/`
