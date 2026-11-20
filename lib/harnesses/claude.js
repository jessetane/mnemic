import fs from 'node:fs'
import path from 'node:path'
import {
	cleanPreview,
	copyFiles,
	isSafeId,
	isUpToDate,
	mirrorDir,
	normalizeDate,
	readJsonl,
	saveBase64Upload,
	writeAtomicFile,
	writeTranscript
} from '../store.js'

const INTERRUPT_MARKERS = new Set([
	'[Request interrupted by user]',
	'[Request interrupted by user for tool use]'
])
const PEER_LEADS = [
	'Another Claude session sent a message while you were working:\n',
	'Another Claude session sent a message:\n',
	'A peer session sent a message while you were working:\n'
]
const PEER_TAIL_MARKERS = [
	'\n\nThis came from another Claude session ',
	'\n\nThat "other Claude session" is an agent working inside this same session ',
	'\n\nIMPORTANT: This is NOT from your user ',
	'\n\nThis is from another Claude session, not your user.'
]

function unwrapPeerContent (text) {
	const lead = PEER_LEADS.find(prefix => text.startsWith(prefix))
	if (!lead) return text
	let body = text.slice(lead.length)
	for (const marker of PEER_TAIL_MARKERS) {
		const idx = body.lastIndexOf(marker)
		if (idx !== -1) {
			body = body.slice(0, idx)
			break
		}
	}
	return body.trim()
}

function isSkippedUserText (text) {
	return !text ||
		INTERRUPT_MARKERS.has(text) ||
		text.startsWith('<command-name>') ||
		text.startsWith('<local-command-')
}

function extractUserBlocks (content) {
	if (typeof content === 'string') {
		const cleaned = unwrapPeerContent(content).trim()
		if (isSkippedUserText(cleaned)) return { text: '', mediaBlocks: [] }
		return { text: cleaned, mediaBlocks: [] }
	}
	if (!Array.isArray(content)) return { text: '', mediaBlocks: [] }
	const parts = []
	const mediaBlocks = []
	for (const block of content) {
		if (!block || typeof block !== 'object') continue
		if (block.type === 'text' && block.text) {
			const cleaned = unwrapPeerContent(block.text).trim()
			if (!isSkippedUserText(cleaned)) parts.push(cleaned)
		} else if ((block.type === 'image' || block.type === 'document') && block.source?.type === 'base64' && block.source.data) {
			mediaBlocks.push(block)
		}
	}
	return { text: parts.join('\n'), mediaBlocks }
}

function mergeAssistantChunk (target, { model, thinkParts, textParts, toolCalls }) {
	if (model && !target.model) target.model = model
	if (thinkParts.length) {
		target.thinking = target.thinking
			? `${target.thinking}\n\n${thinkParts.join('\n\n')}`
			: thinkParts.join('\n\n')
	}
	if (textParts.length) {
		target.content = target.content
			? `${target.content}\n\n${textParts.join('\n\n')}`
			: textParts.join('\n\n')
	}
	if (toolCalls.length) {
		target.toolCalls = target.toolCalls ? target.toolCalls.concat(toolCalls) : toolCalls
	}
}

function parseSession (filePath, convDir) {
	const { records, truncated } = readJsonl(filePath)
	const staged = []
	const workspaces = new Set()
	const stepByUuid = new Map()
	let activeMsgId = null
	let activeAssistant = null
	let aiTitle = ''
	let lastTimestamp = ''
	let sidechainOnly = true
	let sawMessage = false
	function truncateFrom (fromIdx) {
		if (fromIdx >= staged.length) return
		staged.length = fromIdx
		for (const [uuid, idx] of stepByUuid) {
			if (idx >= fromIdx) stepByUuid.delete(uuid)
		}
		const tail = staged[staged.length - 1]
		activeAssistant = tail?.turn.type === 'assistant' ? tail.turn : null
		activeMsgId = tail?.turn.type === 'assistant' ? tail.msgId : null
	}
	for (const rec of records) {
		if (rec.cwd) workspaces.add(rec.cwd)
		if (rec.timestamp) lastTimestamp = rec.timestamp
		if (rec.type === 'ai-title' && rec.aiTitle) {
			aiTitle = rec.aiTitle
			continue
		}
		if (rec.isSidechain) {
			if (rec.type === 'user' || rec.type === 'assistant') sawMessage = true
			continue
		}
		const hasKnownParent = typeof rec.parentUuid === 'string' && stepByUuid.has(rec.parentUuid)
		const parentStep = hasKnownParent ? stepByUuid.get(rec.parentUuid) : (staged.length - 1)
		if (rec.uuid) stepByUuid.set(rec.uuid, parentStep)
		if (rec.type !== 'user' && rec.type !== 'assistant') continue
		sawMessage = true
		sidechainOnly = false
		if (rec.type === 'user') {
			const msgContent = rec.message?.content
			if (Array.isArray(msgContent) && msgContent.length > 0 && msgContent.every(b => b?.type === 'tool_result')) {
				continue
			}
			if (rec.toolUseResult || (rec.isMeta && rec.origin?.kind !== 'peer')) continue
			const { text, mediaBlocks } = extractUserBlocks(msgContent)
			if (!text && !mediaBlocks.length) continue
			if (rec.parentUuid === null && staged.length > 0) {
				truncateFrom(0)
			} else if (hasKnownParent && parentStep + 1 < staged.length) {
				truncateFrom(parentStep + 1)
			}
			activeMsgId = null
			activeAssistant = null
			const idx = staged.length
			staged.push({
				mediaBlocks,
				turn: {
					type: 'user',
					timestamp: rec.timestamp || null,
					content: text
				}
			})
			if (rec.uuid) stepByUuid.set(rec.uuid, idx)
		} else if (rec.type === 'assistant') {
			const blocks = Array.isArray(rec.message?.content) ? rec.message.content : []
			const textParts = []
			const thinkParts = []
			const toolCalls = []
			for (const b of blocks) {
				if (!b || typeof b !== 'object') continue
				if (b.type === 'text' && b.text) textParts.push(b.text.trim())
				else if (b.type === 'thinking' && b.thinking) thinkParts.push(b.thinking.trim())
				else if (b.type === 'tool_use') {
					toolCalls.push({ name: b.name, args: b.input ?? {} })
				}
			}
			const cleanText = textParts.filter(Boolean)
			const cleanThink = thinkParts.filter(Boolean)
			if (!cleanText.length && !cleanThink.length && !toolCalls.length) continue
			const model = rec.message?.model && rec.message.model !== '<synthetic>'
				? rec.message.model
				: null
			const msgId = rec.message?.id || null
			if (activeAssistant && msgId && msgId === activeMsgId) {
				if (rec.timestamp) activeAssistant.timestamp = rec.timestamp
				mergeAssistantChunk(activeAssistant, { model, thinkParts: cleanThink, textParts: cleanText, toolCalls })
				if (rec.uuid) stepByUuid.set(rec.uuid, staged.length - 1)
			} else {
				if (rec.parentUuid === null && staged.length > 0) {
					truncateFrom(0)
				} else if (hasKnownParent && parentStep + 1 < staged.length) {
					truncateFrom(parentStep + 1)
				}
				const turn = {
					type: 'assistant',
					timestamp: rec.timestamp || null
				}
				mergeAssistantChunk(turn, { model, thinkParts: cleanThink, textParts: cleanText, toolCalls })
				const idx = staged.length
				staged.push({ msgId, turn })
				activeAssistant = turn
				activeMsgId = msgId
				if (rec.uuid) stepByUuid.set(rec.uuid, idx)
			}
		}
	}
	const turns = []
	let uploadCount = 0
	let firstPrompt = ''
	for (const item of staged) {
		if (item.turn.type === 'user') {
			if (!firstPrompt && item.turn.content) firstPrompt = cleanPreview(item.turn.content)
			if (item.mediaBlocks.length) {
				const attachments = []
				for (const b of item.mediaBlocks) {
					uploadCount++
					attachments.push(saveBase64Upload(convDir, uploadCount, b.source.media_type, b.source.data))
				}
				item.turn.attachments = attachments
			}
		}
		turns.push(item.turn)
	}
	return {
		turns,
		aiTitle,
		firstPrompt,
		lastTimestamp,
		workspaces: Array.from(workspaces),
		isSubagent: sawMessage && sidechainOnly,
		truncated
	}
}

function syncUserMcpConfig (claudeDir, destClaudeDir) {
	const claudeJson = path.join(path.dirname(claudeDir), '.claude.json')
	if (!fs.existsSync(claudeJson)) return
	const raw = JSON.parse(fs.readFileSync(claudeJson, 'utf8'))
	const extracted = {}
	if (raw.mcpServers && Object.keys(raw.mcpServers).length) {
		extracted.mcpServers = raw.mcpServers
	}
	if (raw.projects && typeof raw.projects === 'object') {
		const projectMcp = {}
		for (const [projPath, cfg] of Object.entries(raw.projects)) {
			if (cfg?.mcpServers && Object.keys(cfg.mcpServers).length) {
				projectMcp[projPath] = { mcpServers: cfg.mcpServers }
			}
		}
		if (Object.keys(projectMcp).length) extracted.projects = projectMcp
	}
	if (Object.keys(extracted).length) {
		writeAtomicFile(
			path.join(destClaudeDir, 'mcp.json'),
			JSON.stringify(extracted, null, '\t') + '\n',
			{ mode: 0o600 }
		)
	}
}

function syncProjectMemories (projectsRoot, destClaudeDir) {
	for (const proj of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
		if (!proj.isDirectory() || proj.name.startsWith('.')) continue
		const memDir = path.join(projectsRoot, proj.name, 'memory')
		if (!fs.existsSync(memDir)) continue
		const entries = fs.readdirSync(memDir).filter(n => !n.startsWith('.'))
		if (!entries.length) continue
		mirrorDir(memDir, path.join(destClaudeDir, 'memory', proj.name))
	}
}

export function syncClaude ({ sourceDir, targetDir, stats }) {
	if (!fs.existsSync(sourceDir)) return
	const destClaudeDir = path.join(targetDir, 'claude')
	copyFiles(sourceDir, destClaudeDir, ['CLAUDE.md', 'AGENTS.md', 'settings.json', 'keybindings.json'])
	for (const dirName of ['rules', 'skills', 'agents', 'hooks']) {
		mirrorDir(path.join(sourceDir, dirName), path.join(destClaudeDir, dirName))
	}
	syncUserMcpConfig(sourceDir, destClaudeDir)
	const projectsRoot = path.join(sourceDir, 'projects')
	if (!fs.existsSync(projectsRoot)) return
	syncProjectMemories(projectsRoot, destClaudeDir)
	const convRoot = path.join(destClaudeDir, 'conversations')
	for (const proj of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
		if (!proj.isDirectory() || proj.name.startsWith('.')) continue
		const projDir = path.join(projectsRoot, proj.name)
		for (const entry of fs.readdirSync(projDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
			const id = entry.name.slice(0, -'.jsonl'.length)
			if (!isSafeId(id)) continue
			const sessionPath = path.join(projDir, entry.name)
			stats.scanned++
			const srcStat = fs.statSync(sessionPath)
			const convDir = path.join(convRoot, id)
			const destTranscript = path.join(convDir, 'transcript.jsonl')
			if (isUpToDate(destTranscript, srcStat.mtimeMs)) {
				stats.unchanged++
				continue
			}
			const parsed = parseSession(sessionPath, convDir)
			if (parsed.isSubagent) {
				stats.skippedSubagents++
				continue
			}
			if (parsed.turns.length === 0) continue
			const meta = {
				id,
				harness: 'claude',
				date: normalizeDate(parsed.lastTimestamp, srcStat.mtimeMs),
				title: parsed.aiTitle || parsed.firstPrompt.slice(0, 80),
				preview: parsed.firstPrompt,
				workspaces: parsed.workspaces,
				turns: parsed.turns.length,
				artifacts: []
			}
			writeTranscript(destTranscript, meta, parsed.turns, parsed.truncated ? 0 : srcStat.mtimeMs)
			stats.archived++
		}
	}
}
