# Security policy

Nuskha processes clinical documents. A defect here can leak patient data or
corrupt a health record, so security reports are taken seriously and handled
before feature work.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
the **Report a vulnerability** button on this repository's Security tab. The
report and the discussion that follows stay private to the maintainers until
an advisory is published.

Expect an acknowledgement within 72 hours and an assessment within seven days.

## Scope

In scope:

- Anything that could expose document content, extracted values or credentials
- Bundle corruption: a composer emitting a resource that misrepresents the
  source document in a clinically significant way
- Dependency vulnerabilities reachable from library code

Out of scope:

- Accuracy of extraction. Low recall is a known, measured property of this
  system and is reported in the benchmark, not treated as a vulnerability.
- Vulnerabilities in the ABDM gateway or in NRCeS tooling. Report those to
  their maintainers.

## Handling patient data

Never attach real clinical documents to an issue, a pull request or a security
report. If a defect can only be shown with a real document, say so and we will
arrange a private channel. Synthetic reproductions are generated from a seed and
are always preferable.
