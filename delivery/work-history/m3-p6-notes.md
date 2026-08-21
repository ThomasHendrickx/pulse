# M3-P6 working notes (card-descriptor merchant grouping, display-only PAN masking)

Appended as the work happens (clause incremental-output). Nothing from the real
statements is written here: the uploads are referred to by 8-hex prefix only
(39bada64 Belfius current account, 0f79fa3d KBC card) and every measurement is
recorded as a COUNT or an abstract shape, never as content.

## 2026-08-21 start

- Read the brief in full, including the appended fleet warnings.
- Read pulse-domain, pulse-typescript, pulse-frontend.
- `df -h /` before any gate or e2e work (fleet warning 10): 19G available, 51% used. OK.
- Toolchain: ambient `node -v` is v26.7.0 (nvm default 26). `npm ci` under
  /opt/node22/bin (node v22.22.2, npm 10.9.7) FAILED: `Missing: @swc/helpers@0.5.23
  from lock file`. Under the ambient node v26.7.0 / npm 11.19.0 `npm ci` exited 0.
  Recorded as an environment warning: the committed lockfile resolves under npm 11,
  not npm 10, even though package.json engines pins node 22.x.
