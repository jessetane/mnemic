# mnemic
Plain-file backups for local AI agents.

## Why
Local harnesses scatter your conversation data across hidden directories full of caches, binary blobs and gigabytes of raw tool output, sometimes silently evicting it along with any of your otherwise uncaptured knowledge, discoveries or inventions. `mnemic` pulls out just the parts worth saving into plain files and normalized JSONL transcripts so you can keep them somewhere safe.

## How

* Zero-dependency CLI and module built on `node:sqlite` and `node:fs`.
* Pulls configs, rules, skills, memories, artifacts, and uploads from Antigravity(`-cli`), Claude Code, and Goose.
* Normalizes root conversations to `conversations/<id>/transcript.jsonl`, skipping caches, subagent noise, and raw tool stdout.
* Incremental and additive so `grep`, `rsync`, and `git` just work.

## Install

```sh
npm i -g github:jessetane/mnemic
```

## Usage

### CLI

```sh
mnemic /Volumes/Backup/ai
mnemic /Volumes/Backup/ai -h gemini,claude
mnemic /Volumes/Backup/ai -h antigravity,antigravity-cli -h goose
```

Override harness locations:

```sh
mnemic ./archive \
    --gemini ~/.gemini \
    --claude ~/.claude \
    --goose-data ~/.local/share/goose \
    --goose-config ~/.config/goose
```

Search conversations:

```sh
grep -ri "freecad" /Volumes/Backup/ai
```

### As a JavaScript module

```js
import { sync } from 'mnemic'

const stats = sync({
    harnesses: ['antigravity-cli', 'claude'],
    targetDir: '/Volumes/Backup/ai'
})
console.log(stats)
```

## Output

### Directory layout

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

### Transcript schema

```json
{"type":"meta","id":"...","harness":"claude","date":"2026-11-19","title":"...","preview":"...","workspaces":["..."],"turns":2,"artifacts":["..."]}
{"type":"user","timestamp":"2026-11-19T20:00:00Z","content":"...","attachments":["uploads/upload-1.pdf"]}
{"type":"assistant","timestamp":"2026-11-19T20:00:05Z","model":"...","thinking":"...","content":"...","toolCalls":[{"name":"...","args":{}}]}
{"type":"error","timestamp":"2026-11-19T20:00:09Z","content":"..."}
```

## Adding Harnesses

Harness adapters live in [`lib/harnesses/`](lib/harnesses) and use helpers from [`lib/store.js`](lib/store.js). Patches welcome to add additional harnesses like `pi`, `codex`, `opencode`, etc.

## Test

```sh
npm test
```

## License

MIT
