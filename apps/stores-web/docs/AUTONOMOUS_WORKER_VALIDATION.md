# Autonomous Worker Validation

Short note on the role of the Linux autonomous worker in this repository.

The Linux autonomous worker may prepare pull requests (branch changes, documentation
updates, and other reviewable contributions), but it must never merge pull requests
or deploy to production automatically. All merges and production deployments remain
explicit human-maintainer actions, subject to normal review and approval.

This file exists to validate the isolated Linux worker end-to-end with a
documentation-only change; it does not alter application behavior.
