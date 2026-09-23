# Security Policy

Boarderoni is a hobby project with no dedicated security team, but reports
are taken seriously and acted on as time allows.

## Scope

Boarderoni is designed to run on a trusted local network — the desktop app
serves its dashboard and control API over plain HTTP with no expectation of
being reachable from the internet, and device pairing/tokens exist to guard
against other devices *on that same network*, not a remote attacker. Reports
about "it's not encrypted/authenticated against the wider internet" are
expected behavior, not a vulnerability, unless you've found a way to reach
it from outside the local network it's bound to.

Relevant surfaces if you *are* reporting something:

- The desktop app's local HTTP/WebSocket server and device-approval flow
- The Android companion app
- Plugins that reach further than the local network (REST Data Sources,
  DCS-BIOS, etc.)

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for a security report. Instead,
use [GitHub's private vulnerability reporting](../../security/advisories/new)
for this repository, or email the maintainer directly (see the profile on
[github.com/spinnekoek](https://github.com/spinnekoek)).

Include enough detail to reproduce the issue — affected version, steps, and
impact. You should get an initial response within a few days; there's no
formal SLA beyond that given this is a one-person project.
