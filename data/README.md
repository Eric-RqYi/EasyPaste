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
