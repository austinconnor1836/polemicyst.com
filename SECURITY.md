# Security Policy

## Supported Versions

Clipfire (formerly Polemicyst) ships continuously from `main`. There are no
maintained back-branches — only the current production deployment is
supported. The `develop` branch ships to the development environment and is
not considered production.

## Reporting a Vulnerability

If you have discovered a security vulnerability in Clipfire, please report it
privately via email:

**[aconnor731@gmail.com](mailto:aconnor731@gmail.com)**

Please include:

- A description of the issue and the impact you believe it has.
- Steps to reproduce, or a proof-of-concept if you have one.
- The commit SHA, environment (prod or dev), and any relevant logs.
- Whether you would like public credit when the issue is disclosed.

We commit to:

- Acknowledging your report within **72 hours**.
- Investigating and confirming (or rejecting) the issue.
- Coordinating a disclosure timeline with you before publishing any fix or
  advisory.

## Out of Scope

The following are not eligible for disclosure rewards (we do not currently
operate a paid bounty program) and will be closed without further action:

- Vulnerabilities that require physical access to a user's device.
- Self-XSS or social-engineering attacks against staff.
- Denial-of-service attacks that rely on volumetric traffic.
- Issues in third-party dependencies that have not been actively exploited
  against Clipfire.
- Findings from automated scanners with no demonstrated impact.

## Please Do Not

- File public GitHub issues for security reports.
- Test against production user data. The development environment
  (`dev.polemicyst.com`) is the only target.
- Disclose the issue publicly before we have had a chance to investigate and
  ship a fix.

See also: [`.well-known/security.txt`](public/.well-known/security.txt) for
the machine-readable RFC 9116 version.
