# Search normalization

`normalize.ts` owns the shared search field generation rules used by seed tooling and search APIs.

- `normalizeSearchText(input)` trims, applies NFKC normalization, lowercases, removes internal whitespace, removes weak search symbols (`-`, `_`, `・`, `.`, `'`, `!`, `?`), and removes bracket characters while preserving bracketed text.
- Hangul syllables are not decomposed during normalization; only whitespace and configured symbols are removed.
- `extractHangulChosung(input)` extracts initials from Hangul syllables only. Non-Hangul characters and existing jamo are excluded.
- `buildAliasSearchFields(alias)` returns `{ normalizedAlias, chosungAlias }` for `song_aliases.csv`.
- `canUseHangulChosungSearch(chosung)` encodes the MVP rule that chosung search is eligible from two or more initials.

Romanization variants are not generated automatically. They should be stored as explicit alias rows.
