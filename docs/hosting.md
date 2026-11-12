# Repository hosting

The canonical repository is https://github.com/subculture-collective/aski. Push branches, open pull requests, file issues and run CI there. GitHub Actions runs `app.yml`, `browser-probe.yml` and `research.yml` on every pull request and on pushes to `main`.

`.github/workflows/mirror.yml` copies every branch and tag to two read-only copies after each push or branch deletion, and hourly as a fallback:

| Copy | Credential (GitHub Actions secret) |
|---|---|
| https://git.subcult.tv/subculture-collective/aski | `GITEA_MIRROR_TOKEN`: a `write:repository` token for the Gitea user `github-mirror`, which has write access to this repository only |
| https://github.com/onnwee/aski | `PERSONAL_MIRROR_SSH_KEY`: the private half of a write deploy key on that repository |

Branches deleted on GitHub are deleted from both copies, and changes pushed directly to a copy are overwritten. Gitea Actions are off for this repository and Actions are disabled on the personal copy, so CI runs only on GitHub.

Issues moved from Gitea on 2026-11-10 with their comments, labels, milestone and dependencies: Gitea issue #N is GitHub issue #N+22 (the roadmap is #23). Each Gitea issue is closed and links to its GitHub copy. Decision records link the GitHub issues; older commits, and the pull-request links in decision records, still point at Gitea by full URL.

To stop mirroring, disable the workflow. To revoke access, delete the deploy key on the personal repository and the `github-mirror` token or user on Gitea.
