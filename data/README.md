# English word data

The plugin bundles the affix rules and dictionary entries from pinned npm packages
`dictionary-en@4.0.0` and `dictionary-en-gb@3.0.0`. Both are derived from SCOWL.
`scripts/build-lexicon.mjs` checks that their affix rules are identical before
deduplicating their dictionary lines. The original dictionary data is otherwise
unchanged; both licenses are copied into release packages.

`frequency-en.txt` is an unchanged copy of SymSpell's English frequency dictionary:

- Source: https://github.com/wolfgarbe/SymSpell/blob/6b8efd7d5053b68013e0193357a79011aa648ce2/SymSpell/frequency_dictionary_en_82_765.txt
- Revision: `6b8efd7d5053b68013e0193357a79011aa648ce2`
- SHA-256: `5eb7d9ca29ba3aee23d11b8b3d3aa048d7e94538b468eeffd9e07f76de7d5125`
- Upstream credits: Google Books Ngrams (CC BY 3.0) and SCOWL.
- See `LICENSE-frequency` and the npm dictionary licenses for attribution and terms.

The build verifies this checksum and includes only lowercase ASCII word/count
pairs in the generated runtime JSON. Frequencies rank possible two-word splits;
they never establish correct spelling by themselves. A candidate part must also
be accepted by nspell or explicitly included in the user's extra vocabulary.

The generated `.generated/english.json` is ignored by git and recreated locally
before tests, builds and watch mode. No data is downloaded by the build or plugin.
To update the data, review the source and licenses, replace the file, and update
the revision and checksum here and in the build script together.

## Conservative US/GB spelling whitelist

`spelling-variants.json` is an exported snapshot derived from ESDB:

- Source: https://github.com/en-wl/wordlist/tree/1e5b7d3a72f47a71da5d28686c1dd4b397178485
- Revision: `1e5b7d3a72f47a71da5d28686c1dd4b397178485`
- Snapshot SHA-256: `06116ad631171f0c7a06d050c0720fb7a3015a253aa8ed53cac9867ba435f6f1`
- Only general US/GB entries at ESDB size <= 60, variant level <= 1 are considered.
- Preferred forms are joined by group and POS, retaining identity mappings from
  other senses. Conflicting mappings, usage/definition notes, marked entries,
  unsupported POS and non-reciprocal pairs are excluded at export time.
- `scripts/build-spelling.mjs` checks the snapshot hash, limits explicit pairs to
  `or/our` and `ize/ise` families (including derived forms), excludes risky forms
  such as `prize/prise`, and rejects ambiguous table keys.
- The resulting 1,640 pairs occupy 49,268 bytes in `.generated/spelling.json`.
  Only that compact array is bundled. Runtime conversion does not import the
  snapshot, database, Python tooling or the spelling engine.
- Full upstream copyright and the modification notice are in `LICENSE-spelling`,
  which is included in installable releases.

Normal npm tests/builds need neither Python, network access nor ESDB. To refresh:

1. Obtain the ESDB source at the exact revision above (review any revision change).
2. In that source tree, run `python3 combine.py create-db scowl.db`.
3. In EasyPaste, run `python3 scripts/export-spelling.py /path/to/scowl.db`.
4. Review the changed pairs, revision, source notices and byte counts. Update the
   pinned revision in the exporter and checksum in the build script when needed.
5. Run `python3 -B tests/export_spelling_test.py` and `npm run check`.

English `-ise` is a style preference: Oxford British `-ize` is also valid. There
is no claim that every proper noun can be distinguished without context. Users
can retain brand names or other spellings via the rule's protected-word list.
