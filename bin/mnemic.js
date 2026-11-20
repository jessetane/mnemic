#!/usr/bin/env node
import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { HARNESSES, parseHarnesses, sync } from '../lib/index.js'

const USAGE = `Usage: mnemic <target-dir> [-h|--harness <${HARNESSES.join('|')}>] [--gemini <dir>] [--claude <dir>] [--goose-data <dir>] [--goose-config <dir>]`

let parsed
try {
	parsed = parseArgs({
		options: {
			harness: { type: 'string', short: 'h', multiple: true },
			gemini: { type: 'string' },
			claude: { type: 'string' },
			'goose-data': { type: 'string' },
			'goose-config': { type: 'string' },
			help: { type: 'boolean' },
			version: { type: 'boolean', short: 'v' }
		},
		allowPositionals: true,
		strict: true
	})
} catch (err) {
	console.error(`${err.message}\n${USAGE}`)
	process.exit(1)
}

const { values, positionals } = parsed

if (values.version) {
	const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
	console.log(pkg.version)
	process.exit(0)
}

if (values.help || positionals.length !== 1) {
	const out = values.help ? console.log : console.error
	out(USAGE)
	process.exit(values.help ? 0 : 1)
}

let harnesses
try {
	harnesses = parseHarnesses(values.harness)
} catch (err) {
	console.error(`${err.message}\n${USAGE}`)
	process.exit(1)
}

const started = Date.now()
const res = sync({
	targetDir: positionals[0],
	harnesses,
	geminiDir: values.gemini,
	claudeDir: values.claude,
	gooseDataDir: values['goose-data'],
	gooseConfigDir: values['goose-config']
})
const elapsed = ((Date.now() - started) / 1000).toFixed(2)
console.log(
	`mnemic (${elapsed}s) -> ${res.targetDir}\n` +
	`  archived: ${res.archived}, unchanged: ${res.unchanged}, skipped subagents: ${res.skippedSubagents}, artifacts: ${res.artifacts}`
)
