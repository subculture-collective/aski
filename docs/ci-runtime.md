# CI runtime

Buran reports an Intel i5-2310 without AVX2; Vite's native build exits with illegal instruction there, while the same locked dependencies pass on Kvant. CI selects the pinned Rolldown 1.2.18 WASI binding with NAPI_RS_FORCE_WASI=error and version enforcement. This explicitly fails if the matching portable binding is missing and leaves native local builds available.

The forced-WASI make check passes on Kvant. Hosted checks establish compatibility on the runner; this note does not claim those checks passed before their result.

Upstream: https://github.com/rolldown/rolldown/blob/main/docs/guide/getting-started.md

The 2,000-character functional browser case creates 72,005 output characters. A matching Ubuntu 24.04 WebKit probe completed without errors in 2.4 seconds with one CPU and 10.2 seconds at a quarter CPU. This case uses a bounded 20-second wait and checks the exact full-output hash; ordinary interaction waits remain unchanged. It is a correctness check, separate from device performance qualification in #42.
