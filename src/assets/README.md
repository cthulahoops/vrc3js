# Vendored renderer assets

These files are checked into this repository so a built client does not rely
on an external asset host at runtime.

`starmap.png` and `moon.png` are exact copies from the `textures` directory of
`cthulahoops/vrc3d` at commit
`8b057126f6eb8ba5e42e3660351970d08b0d2189`:

- `starmap.png` SHA-256: `6ef523a687acd9fb7b88fb829e255ca67db7c9587619bebf612a488ec0787bfd`
- `moon.png` SHA-256: `a9d01750e75cdc6a6763e233c11c81c50033f4010d4011dc48dc1103341484af`

The UI fonts are supplied at build time by the Fontsource npm packages declared
in `package.json`, rather than copied into this directory.
