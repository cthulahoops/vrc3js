# Vendored renderer assets

These files are checked into this repository so a built client does not rely
on an external asset host at runtime.

`starmap.png` and `moon.png` are exact copies from the `textures` directory of
`cthulahoops/vrc3d` at commit
`8b057126f6eb8ba5e42e3660351970d08b0d2189`:

- `starmap.png` SHA-256: `6ef523a687acd9fb7b88fb829e255ca67db7c9587619bebf612a488ec0787bfd`
- `moon.png` SHA-256: `a9d01750e75cdc6a6763e233c11c81c50033f4010d4011dc48dc1103341484af`

`emoji-apple-14.0.0.json` and `emoji-apple-14.0.0.png` are the metadata and
64-pixel Apple sprite sheet from `emoji-datasource-apple` version `14.0.0`:

- `emoji-apple-14.0.0.json` SHA-256: `8f2b971ea2ee3cbf61b89b69649dedfc140803b72b29d69394749e64f3256a31`
- `emoji-apple-14.0.0.png` SHA-256: `f65b5a3e3e32c5aa306ca28299d08896b10012d34ec1c1203f53194ef2be2788`

Apple emoji images are copyrighted by Apple Inc. and are not licensed for
commercial use. The UI fonts are supplied at build time by the Fontsource npm
packages declared in `package.json`, rather than copied into this directory.
