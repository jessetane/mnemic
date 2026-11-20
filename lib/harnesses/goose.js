import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	cleanPreview,
	copyFiles,
	isSafeId,
	isUpToDate,
	mirrorDir,
	normalizeDate,
	parseTimestampMs,
	saveBase64Upload,
	toIsoTimestamp,
	writeTranscript
} from '../store.js'

function parseModelName (modelConfigJson) {
	if (!modelConfigJson) return null
	const parsed = JSON.parse(modelConfigJson)
	return parsed?.model_name || null
}

function parseMessages (rows, defaultModel, convDir) {
	const turns = []
	let uploadCount = 0
	let firstPrompt = ''
	for (const row of rows) {
		const meta = row.metadata_json ? JSON.parse(row.metadata_json) : null
		if (meta && (meta.turnContext || meta.userVisible === false)) continue
		const blocks = JSON.parse(row.content_json)
		if (!Array.isArray(blocks)) continue
		const ts = toIsoTimestamp(row.timestamp)
		if (row.role === 'user') {
			const textParts = []
			const attachments = []
			for (const b of blocks) {
				if (b?.type === 'text' && b.text) textParts.push(b.text)
				else if (b?.type === 'image' && b.data) {
					uploadCount++
					attachments.push(saveBase64Upload(convDir, uploadCount, b.mimeType, b.data))
				}
			}
			const content = textParts.join('\n').trim()
			if (!content && !attachments.length) continue
			if (!firstPrompt && content) firstPrompt = cleanPreview(content)
			const turn = { type: 'user', timestamp: ts, content }
			if (attachments.length) turn.attachments = attachments
			turns.push(turn)
		} else if (row.role === 'assistant') {
			const textParts = []
			const thinkParts = []
			const toolCalls = []
			for (const b of blocks) {
				if (!b || typeof b !== 'object') continue
				if (b.type === 'text' && b.text) textParts.push(b.text.trim())
				else if (b.type === 'thinking' && b.thinking) thinkParts.push(b.thinking.trim())
				else if (b.type === 'toolRequest' && b.toolCall?.value?.name) {
					toolCalls.push({
						name: b.toolCall.value.name,
						args: b.toolCall.value.arguments ?? {}
					})
				}
			}
			const filteredText = textParts.filter(Boolean)
			const filteredThink = thinkParts.filter(Boolean)
			if (!filteredText.length && !filteredThink.length && !toolCalls.length) continue
			const turn = { type: 'assistant', timestamp: ts }
			if (defaultModel) turn.model = defaultModel
			if (filteredThink.length) turn.thinking = filteredThink.join('\n\n')
			if (filteredText.length) turn.content = filteredText.join('\n\n')
			if (toolCalls.length) turn.toolCalls = toolCalls
			turns.push(turn)
		}
	}
	return { turns, firstPrompt }
}

export function syncGoose ({ dataDir, configDir, targetDir, stats }) {
	const dbPath = path.join(dataDir, 'sessions', 'sessions.db')
	const hasDb = fs.existsSync(dbPath)
	const hasConfig = fs.existsSync(configDir)
	if (!hasDb && !hasConfig) return
	const destGooseDir = path.join(targetDir, 'goose')
	if (hasConfig) {
		copyFiles(configDir, destGooseDir, ['config.yaml', 'permission.yaml', '.goosehints'])
		for (const dirName of ['custom_providers', 'recipes', 'prompts']) {
			mirrorDir(path.join(configDir, dirName), path.join(destGooseDir, dirName))
		}
	}
	if (!hasDb) return
	const walPath = `${dbPath}-wal`
	const dbMtimeMs = Math.max(
		fs.statSync(dbPath).mtimeMs,
		fs.existsSync(walPath) ? fs.statSync(walPath).mtimeMs : 0
	)
	const convRoot = path.join(destGooseDir, 'conversations')
	const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 })
	try {
		const sessions = db.prepare(`
			SELECT
				s.id,
				s.name,
				s.description,
				s.session_type,
				s.working_dir,
				s.updated_at,
				s.model_config_json,
				s.parent_session_id,
				(SELECT MAX(m.created_timestamp) FROM messages m WHERE m.session_id = s.id) AS max_msg_ts,
				(SELECT MAX(m.id) FROM messages m WHERE m.session_id = s.id) AS max_msg_id
			FROM sessions s
		`).all()
		const msgStmt = db.prepare(`
			SELECT role, content_json, timestamp, metadata_json
			FROM messages
			WHERE session_id = ?
			ORDER BY created_timestamp ASC, id ASC
		`)
		for (const sess of sessions) {
			if (!isSafeId(sess.id)) continue
			if (sess.parent_session_id || (sess.session_type && sess.session_type !== 'user')) {
				stats.skippedSubagents++
				continue
			}
			stats.scanned++
			const msgTsMs = typeof sess.max_msg_ts === 'number' ? sess.max_msg_ts * 1000 : 0
			const baseMs = Math.max(parseTimestampMs(sess.updated_at, 0), msgTsMs) || dbMtimeMs
			const sourceMtimeMs = baseMs + ((sess.max_msg_id || 0) % 1000)
			const convDir = path.join(convRoot, sess.id)
			const destTranscript = path.join(convDir, 'transcript.jsonl')
			if (isUpToDate(destTranscript, sourceMtimeMs)) {
				stats.unchanged++
				continue
			}
			const model = parseModelName(sess.model_config_json)
			const { turns, firstPrompt } = parseMessages(msgStmt.all(sess.id), model, convDir)
			if (turns.length === 0) continue
			const genericName = !sess.name || sess.name === 'CLI Session' || sess.name === 'New Session'
			const title = (!genericName ? sess.name : '') || sess.description || firstPrompt.slice(0, 80)
			const meta = {
				id: sess.id,
				harness: 'goose',
				date: normalizeDate(sess.updated_at, sourceMtimeMs),
				title,
				preview: sess.description || firstPrompt,
				workspaces: sess.working_dir ? [sess.working_dir] : [],
				turns: turns.length,
				artifacts: []
			}
			writeTranscript(destTranscript, meta, turns, sourceMtimeMs)
			stats.archived++
		}
	} finally {
		db.close()
	}
}
