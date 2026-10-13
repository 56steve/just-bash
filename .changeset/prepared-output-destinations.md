---
"just-bash": patch
---

Keep output redirects bound to the destination opened before command execution. A command that changes directories no longer sends a relative file redirect to its new directory or turns an already-opened `/dev/null` redirect into a regular file write.
