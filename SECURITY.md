# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email security concerns to the maintainers directly, or use GitHub's private vulnerability reporting feature.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond within 72 hours.

## Scope

Talox is a local browser automation tool. It does not run any network-accessible services by default. Security concerns most relevant to this project:

- Profile data leakage between browser contexts
- PolicyEngine YAML injection
- Credential exposure in logs or artifacts
