# Security Policy

## Supported versions

Security fixes are released for the latest version of SwiftGet.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through
[GitHub private vulnerability reporting](https://github.com/ShubratoDn/idm-clone-swiftget/security/advisories/new),
or by email to **shubratodn44985@gmail.com** with the subject "SwiftGet security".

Include a description of the issue, steps to reproduce, and the affected version. You will get an
acknowledgement within a few days, and a fix or mitigation plan as soon as the issue is confirmed.

## Security design notes

- The browser bridge listens on `127.0.0.1` only. It rejects requests that carry a web-page `Origin`,
  and the download endpoint requires a custom header that a web page cannot send without a CORS
  preflight, which SwiftGet never approves. Ordinary websites therefore cannot start downloads.
- Cookies passed from the browser are used only for the download they belong to and are stored in the
  local state file (`%APPDATA%\com.swiftget.app\state.json`) so the download can resume.
- SwiftGet does not collect telemetry and makes no network requests other than the downloads you start.
