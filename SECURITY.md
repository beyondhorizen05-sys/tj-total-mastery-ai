# Security policy

TJ is under active development. Do not use it for unattended high-risk actions or store secrets in a public issue.

To report a vulnerability, use GitHub's private vulnerability reporting for this repository if available, or contact the maintainers privately through the repository owner. Include reproduction steps without publishing credentials or personal data.

Never commit `.env`, `.tj-data`, SQLite databases, vault files, access tokens, screenshots containing personal data, or provider keys. If a secret is exposed, revoke or rotate it; removing it from a later commit does not erase it from Git history.
