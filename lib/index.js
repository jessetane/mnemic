import fs from 'node:fs'
import { expandHome } from './store.js'
import { syncGemini } from './harnesses/gemini.js'
import { syncClaude } from './harnesses/claude.js'
import { syncGoose } from './harnesses/goose.js'

export const HARNESSES = [
	'gemini',
	'antigravity',
	'antigravity-cli',
	'claude',
	'goose'
]

export function parseHarnesses (inputs) {
	if (!inputs || !inputs.length) return []
	const list = []
	for (const raw of inputs) {
		for (const part of raw.split(',')) {
			const trimmed = part.trim()
			if (!trimmed) continue
			if (!HARNESSES.includes(trimmed)) {
				throw new Error(`Unknown harness "${trimmed}" (expected: ${HARNESSES.join(', ')})`)
			}
			list.push(trimmed)
		}
	}
	return list
}

export function sync ({
	targetDir,
	harnesses,
	geminiDir,
	claudeDir,
	gooseDataDir,
	gooseConfigDir
} = {}) {
	if (!targetDir) throw new Error('targetDir is required')
	const selected = parseHarnesses(harnesses)
	const all = selected.length === 0
	const enabled = new Set(selected)
	const resolvedTarget = expandHome(targetDir)
	fs.mkdirSync(resolvedTarget, { recursive: true })
	const stats = {
		scanned: 0,
		archived: 0,
		unchanged: 0,
		skippedSubagents: 0,
		artifacts: 0
	}
	const wantGeminiAll = all || enabled.has('gemini')
	const wantAgySurfaces = !wantGeminiAll && (enabled.has('antigravity') || enabled.has('antigravity-cli'))
	if (wantGeminiAll || wantAgySurfaces) {
		const surfaces = wantGeminiAll
			? null
			: new Set(['antigravity', 'antigravity-cli'].filter(s => enabled.has(s)))
		syncGemini({
			sourceDir: expandHome(geminiDir || '~/.gemini'),
			targetDir: resolvedTarget,
			surfaces,
			stats
		})
	}
	if (all || enabled.has('claude')) {
		syncClaude({
			sourceDir: expandHome(claudeDir || '~/.claude'),
			targetDir: resolvedTarget,
			stats
		})
	}
	if (all || enabled.has('goose')) {
		syncGoose({
			dataDir: expandHome(gooseDataDir || '~/.local/share/goose'),
			configDir: expandHome(gooseConfigDir || '~/.config/goose'),
			targetDir: resolvedTarget,
			stats
		})
	}
	return { ...stats, targetDir: resolvedTarget }
}
