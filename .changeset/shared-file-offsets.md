---
"just-bash": patch
---

Keep shared write offsets for ordinary file redirects and their descriptor copies. Output is delivered after each command, so writes through numeric descriptors are no longer lost or reordered by a redirected group. Truncate files only when opening `>` redirects, preserve unwritten bytes for independent opens, and retain offsets across commands using `exec` redirects. Append redirects write at the current end of the file.

Output redirects to `/dev/stdout` and `/dev/stderr` capture the current destination of fd 1 or fd 2, including file destinations and persistent `exec` redirects. Later redirects do not change that captured destination.
