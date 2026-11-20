# mnemic

Additive, plain-file archive for local AI agent brains and conversations.

## Why

Local-first coding and desktop agents (**Antigravity**, **Claude Code**, **Goose**) store your conversation history, rules, skills, memories, and MCP configs only on your machine—with no built-in cloud backup, opaque binary caches, gigabytes of raw tool-output exhaust, and silent LRU eviction caps (Antigravity evicts past ~500 sessions, including subagents). `mnemic` extracts the signal into one clean, portable JSONL layout that survives eviction and works natively with `grep` and `git`.

## How

* Zero-dependency CLI and module built on Node's native `node:sqlite` and `node:fs`.
* Discovers `~/.gemini`, `~/.claude`, and `~/.local/share/goose` + `~/.config/goose` automatically, mirroring user-authored configs, rules, skills, and memories while skipping symlinks, subagent sidechains, caches, scratch dirs, and raw tool-result stdout walls.
* Writes each root session atomically to `conversations/<id>/transcript.jsonl` alongside optional `artifacts/` and `uploads/` subdirectories, preserving original `mtime` for fast incremental runs and never deleting evicted sessions.

## Install

```sh
npm i -g github:jessetane/mnemic
```

## Usage

### CLI

```sh
mnemic /Volumes/Backup/ai
mnemic /Volumes/Backup/ai -h gemini,claude
mnemic /Volumes/Backup/ai -h antigravity-cli -h goose
```

Supported `-h` / `--harness` values: `gemini` (all Antigravity surfaces), `antigravity`, `antigravity-cli`, `claude`, `goose`.

Search archived sessions with `grep`:

```sh
grep -ri "freecad" /Volumes/Backup/ai
```

Override default source locations if needed:

```sh
mnemic ./archive \
	--gemini ~/.gemini \
	--claude ~/.claude \
	--goose-data ~/.local/share/goose \
	--goose-config ~/.config/goose
```

### As a JavaScript module

```js
import { sync } from 'mnemic'

const stats = sync({
	targetDir: '/Volumes/Backup/ai',
	harnesses: ['antigravity-cli', 'claude']
})
console.log(stats)
```

## Output Layout

```text
<target-dir>/
├── gemini/
│   ├── GEMINI.md
│   ├── config/
│   ├── antigravity/
│   │   └── conversations/<id>/transcript.jsonl
│   └── antigravity-cli/
│       ├── settings.json
│       └── conversations/<id>/
│           ├── transcript.jsonl
│           ├── artifacts/
│           └── uploads/
├── claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── mcp.json
│   ├── skills/
│   ├── memory/
│   └── conversations/<id>/transcript.jsonl
└── goose/
    ├── config.yaml
    ├── custom_providers/
    └── conversations/<id>/transcript.jsonl
```

Every `transcript.jsonl` starts with a `meta` line (`id`, `harness`, `date`, `title`, `preview`, `workspaces`, `turns`, `artifacts`), followed by normalized `user` (`content`, `attachments?`), `assistant` (`model?`, `thinking?`, `content?`, `toolCalls?`), and `error` (`content`) records.

## Adding Harnesses

Each harness lives in a single self-contained module under [`lib/harnesses/`](lib/harnesses) using helpers from [`lib/store.js`](lib/store.js). PRs for additional local-first agents (`pi`, `codex`, `opencode`, etc.) are welcome.

## Test

```sh
npm test
```

## License

MIT
