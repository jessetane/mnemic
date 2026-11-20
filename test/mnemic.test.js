import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { sync } from '../lib/index.js'

const PAST_ISO = '2026-09-02T14:25:00Z'
const PAST_SEC = Date.parse(PAST_ISO) / 1000

function backdate (filePath, sec = PAST_SEC) {
	fs.utimesSync(filePath, sec, sec)
}

function createMockGemini (tmpDir, geminiDir) {
	const desktopBrain = path.join(geminiDir, 'antigravity', 'brain', 'dddddddd-1111-2222-3333-444444444444')
	fs.mkdirSync(path.join(desktopBrain, '.system_generated', 'logs'), { recursive: true })
	const desktopTranscript = path.join(desktopBrain, '.system_generated', 'logs', 'transcript_full.jsonl')
	fs.writeFileSync(
		desktopTranscript,
		JSON.stringify({ step_index: 0, type: 'USER_INPUT', created_at: '2026-09-02T14:00:00Z', content: '<USER_REQUEST>\ndesktop hello\n</USER_REQUEST>' }) + '\n'
	)
	backdate(desktopTranscript)
	const cliDir = path.join(geminiDir, 'antigravity-cli')
	const brainRoot = path.join(cliDir, 'brain')
	const skillDir = path.join(geminiDir, 'config', 'skills', 'demo')
	const externalSkillTarget = path.join(tmpDir, 'external-skill')
	fs.mkdirSync(brainRoot, { recursive: true })
	fs.mkdirSync(skillDir, { recursive: true })
	fs.mkdirSync(externalSkillTarget, { recursive: true })
	fs.writeFileSync(path.join(externalSkillTarget, 'SKILL.md'), '# Linked\n')
	fs.writeFileSync(path.join(geminiDir, 'GEMINI.md'), '# Rules\n')
	fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Demo\n')
	fs.symlinkSync(externalSkillTarget, path.join(geminiDir, 'config', 'skills', 'linked-valid'))
	fs.symlinkSync(path.join(tmpDir, 'nonexistent-target'), path.join(geminiDir, 'config', 'skills', 'linked-dangling'))
	const db = new DatabaseSync(path.join(cliDir, 'conversation_summaries.db'))
	db.exec(`
		CREATE TABLE conversation_summaries (
			conversation_id text PRIMARY KEY,
			title text NOT NULL DEFAULT '',
			preview text NOT NULL DEFAULT '',
			step_count integer NOT NULL DEFAULT 0,
			last_modified_time datetime NOT NULL,
			workspace_uris text NOT NULL,
			parent_conversation_id text NOT NULL DEFAULT ''
		)
	`)
	const insert = db.prepare(`
		INSERT INTO conversation_summaries
		(conversation_id, title, preview, step_count, last_modified_time, workspace_uris, parent_conversation_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	insert.run(
		'11111111-2222-3333-4444-555555555555',
		'Fix FreeCAD EdgeArray Script',
		'Working on edge_array in FreeCAD',
		10,
		'2026-09-02 14:25:00+00:00',
		'["file:///Users/jesse/src/my%20cad"]',
		''
	)
	insert.run(
		'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
		'Subagent Worker',
		'Worker',
		5,
		'2026-09-02 14:25:00+00:00',
		'[]',
		'11111111-2222-3333-4444-555555555555'
	)
	db.close()
	const rootBrain = path.join(brainRoot, '11111111-2222-3333-4444-555555555555')
	fs.mkdirSync(path.join(rootBrain, '.system_generated', 'logs'), { recursive: true })
	fs.mkdirSync(path.join(rootBrain, '.user_uploaded'), { recursive: true })
	fs.mkdirSync(path.join(rootBrain, 'scratch'), { recursive: true })
	fs.writeFileSync(path.join(rootBrain, 'scratch', 'tmp.py'), 'x = 1\n')
	fs.writeFileSync(path.join(rootBrain, '.user_uploaded', 'pasted_123.jpg'), 'fake-jpg')
	const specPath = path.join(rootBrain, 'spec.md')
	fs.writeFileSync(specPath, '# Spec\n')
	backdate(specPath)
	fs.writeFileSync(path.join(rootBrain, 'spec.md.metadata.json'), '{"userFacing":true}\n')
	const transcriptPath = path.join(rootBrain, '.system_generated', 'logs', 'transcript_full.jsonl')
	fs.writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				step_index: 0,
				type: 'USER_INPUT',
				created_at: '2026-09-02T14:20:00Z',
				content: '<USER_REQUEST>\nfix edge_array\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-09-02\n</ADDITIONAL_METADATA>',
				media: [
					{ mime_type: 'image/jpeg', uri: path.join(rootBrain, '.user_uploaded', 'pasted_123.jpg') },
					{ mime_type: 'image/png', uri: path.join(rootBrain, '.user_uploaded', 'missing_gone.png') },
					{ mime_type: 'application/pdf', uri: '/Users/jesse/Downloads/drawing.pdf' }
				]
			}),
			JSON.stringify({ step_index: 1, type: 'GENERIC', created_at: '2026-09-02T14:20:05Z', content: 'giant stdout dump' }),
			JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', created_at: '2026-09-02T14:20:10Z', output_tokens: 0 }),
			JSON.stringify({
				step_index: 3,
				type: 'PLANNER_RESPONSE',
				created_at: '2026-09-02T14:20:30Z',
				content: 'abandoned rewound reply'
			}),
			JSON.stringify({
				step_index: 2,
				type: 'PLANNER_RESPONSE',
				created_at: '2026-09-02T14:21:00Z',
				model: 'gemini-pro',
				thinking: 'checking geometry',
				content: 'fixed edge_array',
				tool_calls: [{ name: 'read_file', args: { Path: '/a.py' } }]
			})
		].join('\n') + '\n'
	)
	backdate(transcriptPath)
	const subBrain = path.join(brainRoot, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
	fs.mkdirSync(path.join(subBrain, '.system_generated', 'logs'), { recursive: true })
	fs.writeFileSync(
		path.join(subBrain, '.system_generated', 'logs', 'transcript_full.jsonl'),
		JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'sub' }) + '\n'
	)
	return { rootBrain, transcriptPath }
}

function createMockClaude (tmpDir, claudeDir) {
	const projDir = path.join(claudeDir, 'projects', '-Users-jesse-src-wye')
	const skillDir = path.join(claudeDir, 'skills', 'wye')
	fs.mkdirSync(projDir, { recursive: true })
	fs.mkdirSync(skillDir, { recursive: true })
	fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{"theme":"dark"}\n')
	fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Wye\n')
	fs.writeFileSync(
		path.join(tmpDir, '.claude.json'),
		JSON.stringify({
			numStartups: 42,
			mcpServers: { demo: { command: 'node', env: { SECRET: '123' } } }
		})
	)
	const rootSession = path.join(projDir, '22222222-3333-4444-5555-666666666666.jsonl')
	fs.writeFileSync(
		rootSession,
		[
			JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }),
			JSON.stringify({
				uuid: 'u0_abandoned',
				parentUuid: null,
				type: 'user',
				isSidechain: false,
				timestamp: '2026-09-02T14:19:00Z',
				cwd: '/Users/jesse/src/wye',
				message: { role: 'user', content: 'abandoned first draft before rewind' }
			}),
			JSON.stringify({
				uuid: 'u1_interrupted',
				parentUuid: 'u0_abandoned',
				type: 'user',
				isSidechain: false,
				timestamp: '2026-09-02T14:20:00Z',
				cwd: '/Users/jesse/src/wye',
				message: { role: 'user', content: '[Request interrupted by user]' }
			}),
			JSON.stringify({
				uuid: 'u2_root',
				parentUuid: null,
				type: 'user',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:00Z',
				cwd: '/Users/jesse/src/wye',
				message: { role: 'user', content: 'summarize wye relay protocol' }
			}),
			JSON.stringify({
				uuid: 'a1_think',
				parentUuid: 'u2_root',
				type: 'assistant',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:05Z',
				cwd: '/Users/jesse/src/wye',
				message: {
					id: 'msg_shared_1',
					role: 'assistant',
					model: 'claude-opus-4-6',
					content: [{ type: 'thinking', thinking: 'inspecting relay' }]
				}
			}),
			JSON.stringify({
				uuid: 'a1_tool',
				parentUuid: 'a1_think',
				type: 'assistant',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:06Z',
				cwd: '/Users/jesse/src/wye',
				message: {
					id: 'msg_shared_1',
					role: 'assistant',
					model: 'claude-opus-4-6',
					content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/Users/jesse/src/wye/README.md' } }]
				}
			}),
			JSON.stringify({
				uuid: 'u3_toolres',
				parentUuid: 'a1_tool',
				type: 'user',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:07Z',
				message: { role: 'user', content: [{ type: 'tool_result', content: 'giant file body' }] }
			}),
			JSON.stringify({
				uuid: 'a1_text',
				parentUuid: 'u3_toolres',
				type: 'assistant',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:10Z',
				cwd: '/Users/jesse/src/wye',
				message: {
					id: 'msg_shared_1',
					role: 'assistant',
					model: 'claude-opus-4-6',
					content: [{ type: 'text', text: 'wye uses E2EE websocket rooms' }]
				}
			}),
			JSON.stringify({
				uuid: 'sys_turn_1',
				parentUuid: 'a1_text',
				type: 'system',
				subtype: 'turn_duration',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:11Z'
			}),
			JSON.stringify({
				uuid: 'u_abandoned',
				parentUuid: 'sys_turn_1',
				type: 'user',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:15Z',
				message: { role: 'user', content: 'abandoned mid-session branch' }
			}),
			JSON.stringify({
				uuid: 'a_abandoned',
				parentUuid: 'u_abandoned',
				type: 'assistant',
				isSidechain: false,
				timestamp: '2026-09-02T14:21:16Z',
				message: {
					id: 'msg_abandoned',
					role: 'assistant',
					model: 'claude-opus-4-6',
					content: [{ type: 'text', text: 'abandoned reply' }]
				}
			}),
			JSON.stringify({
				uuid: 'u4_peer',
				parentUuid: 'sys_turn_1',
				type: 'user',
				isMeta: true,
				origin: { kind: 'peer' },
				isSidechain: false,
				timestamp: '2026-09-02T14:21:20Z',
				cwd: '/Users/jesse/src/wye',
				message: {
					role: 'user',
					content: 'Another Claude session sent a message:\nhello from guest\n\nThis is from another Claude session, not your user.'
				}
			}),
			JSON.stringify({
				type: 'ai-title',
				aiTitle: 'Wye Relay Summary',
				sessionId: '22222222-3333-4444-5555-666666666666'
			})
		].join('\n') + '\n'
	)
	backdate(rootSession)
	const sidechainSession = path.join(projDir, '99999999-8888-7777-6666-555555555555.jsonl')
	fs.writeFileSync(
		sidechainSession,
		JSON.stringify({
			type: 'user',
			isSidechain: true,
			timestamp: '2026-09-02T14:22:00Z',
			message: { role: 'user', content: 'subagent prompt' }
		}) + '\n'
	)
	return { rootSession }
}

function createMockGoose (gooseDataDir, gooseConfigDir) {
	fs.mkdirSync(path.join(gooseDataDir, 'sessions'), { recursive: true })
	fs.mkdirSync(path.join(gooseConfigDir, 'custom_providers'), { recursive: true })
	fs.writeFileSync(path.join(gooseConfigDir, 'config.yaml'), 'GOOSE_MODE: auto\n')
	fs.writeFileSync(path.join(gooseConfigDir, 'custom_providers', 'local.json'), '{}')
	const dbPath = path.join(gooseDataDir, 'sessions', 'sessions.db')
	const db = new DatabaseSync(dbPath)
	db.exec(`
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			session_type TEXT NOT NULL DEFAULT 'user',
			working_dir TEXT NOT NULL,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			model_config_json TEXT,
			parent_session_id TEXT
		);
		CREATE TABLE messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content_json TEXT NOT NULL,
			created_timestamp INTEGER NOT NULL,
			timestamp TIMESTAMP,
			metadata_json TEXT
		);
	`)
	db.prepare(`
		INSERT INTO sessions (id, name, description, session_type, working_dir, updated_at, model_config_json, parent_session_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run('20260902_3', 'Sky color', '', 'user', '/Users/jesse', '2026-09-02 14:25:00', '{"model_name":"qwen3-27b"}', null)
	db.prepare(`
		INSERT INTO sessions (id, name, description, session_type, working_dir, updated_at, model_config_json, parent_session_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run('20260902_sub', 'Sub', '', 'sub_recipe', '/Users/jesse', '2026-09-02 14:25:01', null, '20260902_3')
	const insertMsg = db.prepare(`
		INSERT INTO messages (session_id, role, content_json, created_timestamp, timestamp, metadata_json)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	insertMsg.run(
		'20260902_3',
		'user',
		JSON.stringify([{ type: 'text', text: 'what color is the sky' }]),
		1791003958,
		'2026-09-02 14:24:58',
		JSON.stringify({ userVisible: true })
	)
	insertMsg.run(
		'20260902_3',
		'user',
		JSON.stringify([{ type: 'text', text: '<turn-context>hidden</turn-context>' }]),
		1791003958,
		'2026-09-02 14:24:58',
		JSON.stringify({ userVisible: false, turnContext: true })
	)
	insertMsg.run(
		'20260902_3',
		'assistant',
		JSON.stringify([
			{ type: 'thinking', thinking: 'Rayleigh scattering' },
			{ type: 'toolRequest', toolCall: { value: { name: 'shell', arguments: { command: 'ls' } } } },
			{ type: 'text', text: 'Blue during the day' }
		]),
		1791003959,
		'2026-09-02 14:25:00',
		JSON.stringify({ userVisible: true })
	)
	db.close()
	backdate(dbPath)
	return { dbPath }
}

test('normalizes Antigravity, Claude Code, and Goose with rewinds, coalescing, symlinks, and eviction safety', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemic-test-'))
	try {
		const geminiDir = path.join(tmp, 'gemini')
		const claudeDir = path.join(tmp, 'claude')
		const gooseDataDir = path.join(tmp, 'goose-data')
		const gooseConfigDir = path.join(tmp, 'goose-config')
		const targetDir = path.join(tmp, 'archive')
		const { rootBrain, transcriptPath } = createMockGemini(tmp, geminiDir)
		const { rootSession } = createMockClaude(tmp, claudeDir)
		const { dbPath: gooseDb } = createMockGoose(gooseDataDir, gooseConfigDir)
		const first = sync({ targetDir, geminiDir, claudeDir, gooseDataDir, gooseConfigDir })
		assert.equal(first.archived, 4)
		assert.equal(first.skippedSubagents, 3)
		assert.equal(first.artifacts, 1)
		const agyDir = path.join(targetDir, 'gemini', 'antigravity-cli', 'conversations', '11111111-2222-3333-4444-555555555555')
		const agyTranscript = path.join(agyDir, 'transcript.jsonl')
		assert.equal(fs.existsSync(agyTranscript), true)
		assert.equal(fs.existsSync(path.join(agyDir, 'artifacts', 'spec.md')), true)
		assert.equal(fs.existsSync(path.join(agyDir, 'artifacts', 'spec.md.metadata.json')), false)
		assert.equal(fs.existsSync(path.join(agyDir, 'uploads', 'pasted_123.jpg')), true)
		assert.equal(fs.existsSync(path.join(agyDir, 'scratch')), false)
		assert.equal(fs.existsSync(path.join(targetDir, 'gemini', 'config', 'skills', 'demo', 'SKILL.md')), true)
		assert.equal(fs.existsSync(path.join(targetDir, 'gemini', 'config', 'skills', 'linked-valid')), false)
		assert.equal(fs.existsSync(path.join(targetDir, 'gemini', 'config', 'skills', 'linked-dangling')), false)
		const mcpPath = path.join(targetDir, 'claude', 'mcp.json')
		assert.equal(fs.existsSync(mcpPath), true)
		assert.equal(fs.statSync(mcpPath).mode & 0o777, 0o600)
		const agyLines = fs.readFileSync(agyTranscript, 'utf8').trim().split('\n').map(l => JSON.parse(l))
		assert.deepEqual(agyLines.map(l => l.type), ['meta', 'user', 'assistant'])
		assert.equal(agyLines[0].harness, 'antigravity-cli')
		assert.deepEqual(agyLines[0].artifacts, ['artifacts/spec.md'])
		assert.deepEqual(agyLines[0].workspaces, ['/Users/jesse/src/my cad'])
		assert.equal(agyLines[1].content, 'fix edge_array')
		assert.deepEqual(agyLines[1].attachments, ['uploads/pasted_123.jpg', '/Users/jesse/Downloads/drawing.pdf'])
		assert.equal(agyLines[2].content, 'fixed edge_array')
		const claudeTranscript = path.join(targetDir, 'claude', 'conversations', '22222222-3333-4444-5555-666666666666', 'transcript.jsonl')
		const claudeLines = fs.readFileSync(claudeTranscript, 'utf8').trim().split('\n').map(l => JSON.parse(l))
		assert.deepEqual(claudeLines.map(l => l.type), ['meta', 'user', 'assistant', 'user'])
		assert.equal(claudeLines[0].harness, 'claude')
		assert.equal(claudeLines[0].title, 'Wye Relay Summary')
		assert.equal(claudeLines[1].content, 'summarize wye relay protocol')
		assert.equal(claudeLines[2].thinking, 'inspecting relay')
		assert.equal(claudeLines[2].content, 'wye uses E2EE websocket rooms')
		assert.equal(claudeLines[2].toolCalls[0].name, 'Read')
		assert.equal(claudeLines[3].content, 'hello from guest')
		const gooseTranscript = path.join(targetDir, 'goose', 'conversations', '20260902_3', 'transcript.jsonl')
		const gooseLines = fs.readFileSync(gooseTranscript, 'utf8').trim().split('\n').map(l => JSON.parse(l))
		assert.deepEqual(gooseLines.map(l => l.type), ['meta', 'user', 'assistant'])
		assert.equal(gooseLines[0].harness, 'goose')
		const second = sync({ targetDir, geminiDir, claudeDir, gooseDataDir, gooseConfigDir })
		assert.equal(second.archived, 0)
		assert.equal(second.unchanged, 4)
		fs.appendFileSync(transcriptPath, '{"step_index":2,"type":"PLANNER_RESPONSE","content":"half-written')
		backdate(transcriptPath, PAST_SEC + 60)
		const midWrite = sync({ targetDir, geminiDir, claudeDir, gooseDataDir, gooseConfigDir })
		assert.equal(midWrite.archived, 1)
		fs.rmSync(rootBrain, { recursive: true, force: true })
		fs.rmSync(rootSession, { force: true })
		fs.rmSync(gooseDb, { force: true })
		sync({ targetDir, geminiDir, claudeDir, gooseDataDir, gooseConfigDir })
		assert.equal(fs.existsSync(agyTranscript), true)
		assert.equal(fs.existsSync(claudeTranscript), true)
		assert.equal(fs.existsSync(gooseTranscript), true)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('CLI requires target-dir and supports repeatable/comma -h|--harness filters', () => {
	const cli = new URL('../bin/mnemic.js', import.meta.url).pathname
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemic-cli-test-'))
	try {
		const geminiDir = path.join(tmp, 'gemini')
		const claudeDir = path.join(tmp, 'claude')
		const outSurfaceOnly = path.join(tmp, 'out-cli-only')
		const outBoth = path.join(tmp, 'out-gemini-claude')
		createMockGemini(tmp, geminiDir)
		createMockClaude(tmp, claudeDir)
		assert.equal(spawnSync(process.execPath, [cli]).status, 1)
		assert.equal(spawnSync(process.execPath, [cli, outSurfaceOnly, '--bogus']).status, 1)
		assert.equal(spawnSync(process.execPath, [cli, outSurfaceOnly, '-h', 'not-a-harness']).status, 1)
		assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0)
		assert.equal(spawnSync(process.execPath, [cli, '--version']).status, 0)
		const cliOnly = spawnSync(process.execPath, [
			cli,
			outSurfaceOnly,
			'--gemini', geminiDir,
			'--claude', claudeDir,
			'-h', 'antigravity-cli'
		])
		assert.equal(cliOnly.status, 0)
		assert.equal(fs.existsSync(path.join(outSurfaceOnly, 'gemini', 'antigravity-cli', 'conversations')), true)
		assert.equal(fs.existsSync(path.join(outSurfaceOnly, 'gemini', 'antigravity')), false)
		assert.equal(fs.existsSync(path.join(outSurfaceOnly, 'claude')), false)
		const geminiAndClaude = spawnSync(process.execPath, [
			cli,
			outBoth,
			'--gemini', geminiDir,
			'--claude', claudeDir,
			'-h', 'gemini,claude'
		])
		assert.equal(geminiAndClaude.status, 0)
		assert.equal(fs.existsSync(path.join(outBoth, 'gemini', 'antigravity', 'conversations')), true)
		assert.equal(fs.existsSync(path.join(outBoth, 'gemini', 'antigravity-cli', 'conversations')), true)
		assert.equal(fs.existsSync(path.join(outBoth, 'claude', 'conversations')), true)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})
