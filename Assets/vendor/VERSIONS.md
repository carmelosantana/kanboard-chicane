# Vendored libraries

Copied unmodified from the npm registry tarballs (integrity checked against the registry's
`dist.integrity` sha512 before extraction; nothing installed, no scripts run). Loaded by
`Template/race/page.php` in this order.

| File | Package | Source path in tarball | Licence | sha256 |
| --- | --- | --- | --- | --- |
| `pixi-8.22.0.min.js` | `pixi.js@8.22.0` | `dist/pixi.min.js` | MIT | `06d9ef9823e743518793083c296d801e752db128cb1f519fbabe37e1259567ea` |
| `pixi-unsafe-eval-8.22.0.min.js` | `pixi.js@8.22.0` | `dist/packages/unsafe-eval.min.js` | MIT | `80d5eabed0e1286e2f646b272687170d9211ecd1c901b3382c2d5274ba2c42a9` |
| `gsap-3.15.0.min.js` | `gsap@3.15.0` | `dist/gsap.min.js` | GSAP Standard "no charge" licence | `92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb` |
| `gsap-motionpath-3.15.0.min.js` | `gsap@3.15.0` | `dist/MotionPathPlugin.min.js` | GSAP Standard "no charge" licence | `ace44a07c6c179f5347d9b46a152d468e4c9f272ee0d68bf0354e00d60000693` |

- `pixi.js@8.22.0`: published 2026-10-01, npm provenance attestation present, no install scripts
  that run for consumers, no optional or git/tarball dependencies. The IIFE build bundles its
  dependencies. `pixi-unsafe-eval` replaces Pixi's `new Function` shader/particle code generation so
  the page runs under Kanboard's CSP (`default-src 'self'`, no `unsafe-eval`).
- `gsap@3.15.0`: published 2026-04-13, single maintainer (`greensock`), no dependencies, no scripts,
  no provenance attestation. Licence: Webflow's GSAP Standard "no charge" licence
  (<https://gsap.com/standard-license>) — free to use and redistribute, but **not an OSI-approved
  licence**. If that ever matters, the fallback is Motion 14.5 (MIT) via its UMD build.

To update: download the new tarballs into an empty scratch directory, verify `dist.integrity`, copy
only these dist files under the new versioned names, update this table and `page.php`.
