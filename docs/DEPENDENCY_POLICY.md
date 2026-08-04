# Dependency Policy

## Security Audits

Every pull request and push to `main` runs `npm audit --audit-level=high` in the
[`dependency-audit` workflow](.github/workflows/dependency-audit.yml).
Merges are blocked when any dependency has a **high or critical** advisory.

A [weekly scheduled run](.github/workflows/dependency-audit.yml) scans `main` even
when no PR activity occurs, so stale advisories are surfaced without manual effort.

## Allowed Licenses

Third-party **production** dependencies must use one of the following
OSI / FSF-approved licenses:

| SPDX ID          | Full Name                                    |
| ---------------- | -------------------------------------------- |
| `MIT`            | MIT License                                  |
| `Apache-2.0`     | Apache License 2.0                           |
| `ISC`            | ISC License                                  |
| `BSD-2-Clause`   | BSD 2-Clause "Simplified" License            |
| `BSD-3-Clause`   | BSD 3-Clause "New" or "Revised" License      |
| `CC0-1.0`        | Creative Commons Zero v1.0 Universal         |
| `Unlicense`      | The Unlicense                                |
| `BlueOak-1.0.0`  | Blue Oak Model License 1.0.0                 |
| `Python-2.0`     | Python License 2.0                           |

The CI `license-checker` step validates every PR against this list.  Only
**production** dependencies (`--production`) are checked; dev-only tooling is
excluded because it never ships to end users.

## Requesting an Exception

If a new dependency with a non-standard license or a known advisory is
unavoidable:

1. Open an issue titled `Dependency Exception: <package-name>`.
2. Explain why the package is required and why no compliant alternative exists.
3. A maintainer will decide whether to grant a temporary exception and either
   adjust the CI allowlist or add a `.nsprc` / `--ignore` waiver.

All exceptions are documented in this file and reviewed at least quarterly.
