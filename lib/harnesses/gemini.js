import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	cleanPreview,
	copyFileAtomic,
	copyFiles,
	isSafeId,
	isUpToDate,
	latestTreeMtimeMs,
	mirrorDir,
	normalizeDate,
	parseTimestampMs,
	readJsonl,
	unwrapUserRequest,
	writeTranscript
} from '../store.js'

const IGNORED_BRAIN_ENTRIES = new Set([
	'.system_generated',
	'.user_uploaded',
	'.tempmediaStorage',
	'scratch',
	'browser_sandbox',
	'browser_evidence',
	'.DS_Store'
])

function decodeFileUri (uri) {
	if (!uri.startsWith('file://')) return uri
	try {
		return decodeURIComponent(new URL(uri).pathname)
	} catch {
		return uri.replace(/^file:\/\//, '')
	}
}

function parseWorkspaces (raw) {
	if (!raw) return []
	const parsed = JSON.parse(raw)
	if (!Array.isArray(parsed)) return []
	return parsed.map(uri => decodeFileUri(uri))
}

function readSummaries (dbPath) {
	const rows = new Map()
	if (!fs.existsSync(dbPath)) return rows
	const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 })
	try {
		const stmt = db.prepare(`
			SELECT
				conversation_id,
				title,
				preview,
				last_modified_time,
				workspace_uris,
				parent_conversation_id
			FROM conversation_summaries
		`)
		for (const row of stmt.all()) {
			rows.set(row.conversation_id, row)
		}
	} finally {
		db.close()
	}
	return rows
}

function collectArtifacts (brainDir) {
	const files = []
	let latestMtimeMs = 0
	for (const entry of fs.readdirSync(brainDir, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) continue
		if (entry.name.startsWith('.') || IGNORED_BRAIN_ENTRIES.has(entry.name)) continue
		if (entry.name.endsWith('.metadata.json') || /^task-\d+$/.test(entry.name)) continue
		files.push(entry.name)
		const entryMs = latestTreeMtimeMs(path.join(brainDir, entry.name))
		if (entryMs > latestMtimeMs) latestMtimeMs = entryMs
	}
	return { files: files.sort(), latestMtimeMs }
}

function copyArtifacts (brainDir, artifactNames, convDir) {
	if (!artifactNames.length) return []
	const artifactsDir = path.join(convDir, 'artifacts')
	for (const name of artifactNames) {
		const src = path.join(brainDir, name)
		const dst = path.join(artifactsDir, name)
		const st = fs.lstatSync(src)
		if (st.isDirectory()) {
			mirrorDir(src, dst)
		} else if (st.isFile()) {
			copyFileAtomic(src, dst)
		}
	}
	return artifactNames.map(name => `artifacts/${name}`)
}

function parseTranscript (srcPath, brainDir, convDir) {
	const { records, truncated } = readJsonl(srcPath)
	const staged = []
	let maxStepIndex = -1
	for (const step of records) {
		const stepIdx = typeof step.step_index === 'number' ? step.step_index : -1
		if (stepIdx >= 0) {
			if (stepIdx <= maxStepIndex) {
				while (staged.length && staged[staged.length - 1].stepIdx >= stepIdx) {
					staged.pop()
				}
			}
			maxStepIndex = stepIdx
		}
		if (step.type === 'USER_INPUT') {
			const content = unwrapUserRequest(step.content)
			const media = Array.isArray(step.media) ? step.media : []
			if (!content && !media.length) continue
			staged.push({
				stepIdx,
				media,
				turn: {
					type: 'user',
					timestamp: step.created_at || null,
					content
				}
			})
		} else if (step.type === 'PLANNER_RESPONSE') {
			const turn = {
				type: 'assistant',
				timestamp: step.created_at || null
			}
			if (step.model) turn.model = step.model
			if (step.thinking) turn.thinking = step.thinking
			if (step.content) turn.content = step.content
			if (Array.isArray(step.tool_calls) && step.tool_calls.length) {
				turn.toolCalls = step.tool_calls.map(tc => ({
					name: tc.name,
					args: tc.args ?? {}
				}))
			}
			if (!turn.thinking && !turn.content && !turn.toolCalls) continue
			staged.push({ stepIdx, turn })
		} else if (step.type === 'ERROR_MESSAGE' && step.content) {
			staged.push({
				stepIdx,
				turn: {
					type: 'error',
					timestamp: step.created_at || null,
					content: step.content
				}
			})
		}
	}
	const turns = []
	const copiedUploads = []
	let firstPrompt = ''
	for (const item of staged) {
		if (item.turn.type === 'user') {
			if (!firstPrompt && item.turn.content) firstPrompt = cleanPreview(item.turn.content)
			if (item.media.length) {
				const attachments = []
				for (const m of item.media) {
					if (!m?.uri) continue
					if (m.uri.startsWith(`${brainDir}${path.sep}`)) {
						if (!fs.existsSync(m.uri)) continue
						const fileName = path.basename(m.uri)
						const relUpload = `uploads/${fileName}`
						copyFileAtomic(m.uri, path.join(convDir, 'uploads', fileName))
						copiedUploads.push(relUpload)
						attachments.push(relUpload)
					} else {
						attachments.push(m.uri)
					}
				}
				if (attachments.length) item.turn.attachments = attachments
			}
		}
		turns.push(item.turn)
	}
	return { turns, firstPrompt, copiedUploads, truncated }
}

export function syncGemini ({ sourceDir, targetDir, surfaces, stats }) {
	if (!fs.existsSync(sourceDir)) return
	const destGeminiDir = path.join(targetDir, 'gemini')
	copyFiles(sourceDir, destGeminiDir, ['GEMINI.md', 'AGENTS.md'])
	mirrorDir(path.join(sourceDir, 'config'), path.join(destGeminiDir, 'config'))
	for (const surf of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		if (!surf.isDirectory() || !surf.name.startsWith('antigravity')) continue
		if (surfaces && !surfaces.has(surf.name)) continue
		const surfaceDir = path.join(sourceDir, surf.name)
		const destSurfaceDir = path.join(destGeminiDir, surf.name)
		copyFiles(surfaceDir, destSurfaceDir, ['settings.json'])
		const brainRoot = path.join(surfaceDir, 'brain')
		if (!fs.existsSync(brainRoot)) continue
		const convRoot = path.join(destSurfaceDir, 'conversations')
		const summaries = readSummaries(path.join(surfaceDir, 'conversation_summaries.db'))
		for (const entry of fs.readdirSync(brainRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith('.') || !isSafeId(entry.name)) continue
			const id = entry.name
			const summary = summaries.get(id)
			if (summary && summary.parent_conversation_id) {
				stats.skippedSubagents++
				continue
			}
			const brainDir = path.join(brainRoot, id)
			const transcriptSrc = path.join(brainDir, '.system_generated', 'logs', 'transcript_full.jsonl')
			if (!fs.existsSync(transcriptSrc)) continue
			stats.scanned++
			const srcStat = fs.statSync(transcriptSrc)
			const { files: artifactFiles, latestMtimeMs: artMtimeMs } = collectArtifacts(brainDir)
			const summaryMs = parseTimestampMs(summary?.last_modified_time, 0)
			const sourceMtimeMs = Math.max(srcStat.mtimeMs, artMtimeMs, summaryMs)
			const convDir = path.join(convRoot, id)
			const destTranscript = path.join(convDir, 'transcript.jsonl')
			if (isUpToDate(destTranscript, sourceMtimeMs)) {
				stats.unchanged++
				continue
			}
			const { turns, firstPrompt, copiedUploads, truncated } = parseTranscript(transcriptSrc, brainDir, convDir)
			const artifacts = copyArtifacts(brainDir, artifactFiles, convDir)
			if (turns.length === 0 && artifacts.length === 0 && copiedUploads.length === 0) continue
			const rawTitle = summary?.title || cleanPreview(summary?.preview, 80)
			const meta = {
				id,
				harness: surf.name,
				date: normalizeDate(summary?.last_modified_time, srcStat.mtimeMs),
				title: rawTitle || firstPrompt.slice(0, 80),
				preview: cleanPreview(summary?.preview) || firstPrompt,
				workspaces: parseWorkspaces(summary?.workspace_uris),
				turns: turns.length,
				artifacts
			}
			writeTranscript(destTranscript, meta, turns, truncated ? 0 : sourceMtimeMs)
			stats.archived++
			stats.artifacts += artifacts.length
		}
	}
}
