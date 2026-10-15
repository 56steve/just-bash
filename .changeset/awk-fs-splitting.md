---
"just-bash": patch
---

Fix three `awk` field-splitting bugs:

- An empty `FS` (`FS = ""`) and `split(s, a, //)` no longer crash with `start index out of bounds`. An empty `FS` now splits a record into characters.
- A single-character `FS` such as `-F'|'` or `-F.` is now a literal separator, as in POSIX awk, instead of a regex.
- A record with more fields than `maxArrayElements` now fails with `field count limit exceeded` even at the default limit, instead of being silently truncated at the regex result cap.
