import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MIME_EXTENSIONS = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/gif': '.gif',
	'image/webp': '.webp',
	'application/pdf': '.pdf'
}

export function expandHome (inputPath, baseDir = process.cwd()) {
	if (inputPath === '~') return os.homedir()
	if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2))
	return path.resolve(baseDir, inputPath)
}

export function isSafeId (id) {
	return Boolean(id) && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\')
}

export function unwrapUserRequest (text) {
	if (!text) return ''
	const match = text.match(/<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/)
	return match ? match[1].trim() : text.trim()
}

export function cleanPreview (text, maxLen = 240) {
	return unwrapUserRequest(text)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLen)
}

export function toIsoTimestamp (raw) {
	if (!raw || raw.startsWith('0001-')) return null
	if (raw.includes('T')) return raw
	return raw.includes('+') || raw.endsWith('Z')
		? raw.replace(' ', 'T')
		: `${raw.replace(' ', 'T')}Z`
}

export function parseTimestampMs (raw, fallbackMs = 0) {
	const iso = toIsoTimestamp(raw)
	if (!iso) return fallbackMs
	const ms = Date.parse(iso)
	return Number.isNaN(ms) ? fallbackMs : ms
}

export function normalizeDate (rawTime, fallbackMtimeMs) {
	if (rawTime && !rawTime.startsWith('0001-')) {
		const match = rawTime.match(/^(\d{4}-\d{2}-\d{2})/)
		if (match) return match[1]
	}
	return new Date(fallbackMtimeMs).toISOString().slice(0, 10)
}

export function readJsonl (filePath) {
	const raw = fs.readFileSync(filePath, 'utf8')
	const lines = raw.split('\n')
	const incompleteTail = lines.pop()
	const truncated = incompleteTail.length > 0
	const records = []
	for (const line of lines) {
		if (!line) continue
		records.push(JSON.parse(line))
	}
	return { records, truncated }
}

export function latestTreeMtimeMs (targetPath) {
	const st = fs.lstatSync(targetPath)
	if (!st.isDirectory()) return st.mtimeMs
	let maxMs = st.mtimeMs
	for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
		if (entry.name === '.DS_Store') continue
		const childMs = latestTreeMtimeMs(path.join(targetPath, entry.name))
		if (childMs > maxMs) maxMs = childMs
	}
	return maxMs
}

export function isUpToDate (transcriptPath, sourceMtimeMs) {
	if (!fs.existsSync(transcriptPath)) return false
	const stat = fs.statSync(transcriptPath)
	if (Date.now() - sourceMtimeMs < 1500) return false
	if (stat.mtimeMs % 1000 === 0 && sourceMtimeMs % 1000 !== 0) {
		return Math.trunc(stat.mtimeMs / 1000) === Math.trunc(sourceMtimeMs / 1000)
	}
	return Math.abs(stat.mtimeMs - sourceMtimeMs) < 5
}

export function copyFileAtomic (src, dst) {
	const srcStat = fs.lstatSync(src)
	if (!srcStat.isFile()) return false
	try {
		const dstStat = fs.lstatSync(dst)
		if (dstStat.isDirectory() || dstStat.isSymbolicLink()) {
			fs.rmSync(dst, { recursive: true, force: true })
		}
	} catch (err) {
		if (err.code !== 'ENOENT') throw err
	}
	fs.mkdirSync(path.dirname(dst), { recursive: true })
	const tmp = `${dst}.tmp`
	fs.copyFileSync(src, tmp)
	fs.chmodSync(tmp, srcStat.mode & 0o777)
	fs.renameSync(tmp, dst)
	return true
}

export function copyFiles (srcDir, dstDir, names) {
	for (const name of names) {
		const src = path.join(srcDir, name)
		if (!fs.existsSync(src)) continue
		copyFileAtomic(src, path.join(dstDir, name))
	}
}

export function mirrorDir (srcDir, dstDir, exclude = new Set(['node_modules', '.DS_Store'])) {
	if (!fs.existsSync(srcDir)) return
	const rootStat = fs.lstatSync(srcDir)
	if (!rootStat.isDirectory()) return
	try {
		const dstRootStat = fs.lstatSync(dstDir)
		if (!dstRootStat.isDirectory()) {
			fs.rmSync(dstDir, { recursive: true, force: true })
		}
	} catch (err) {
		if (err.code !== 'ENOENT') throw err
	}
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		if (exclude.has(entry.name)) continue
		const srcPath = path.join(srcDir, entry.name)
		const dstPath = path.join(dstDir, entry.name)
		const srcStat = fs.lstatSync(srcPath)
		if (srcStat.isSymbolicLink()) continue
		if (srcStat.isDirectory()) {
			mirrorDir(srcPath, dstPath, exclude)
		} else if (srcStat.isFile()) {
			copyFileAtomic(srcPath, dstPath)
		}
	}
}

export function saveBase64Upload (convDir, index, mediaType, base64Data) {
	const ext = MIME_EXTENSIONS[mediaType] || '.bin'
	const fileName = `upload-${index}${ext}`
	const uploadsDir = path.join(convDir, 'uploads')
	fs.mkdirSync(uploadsDir, { recursive: true })
	fs.writeFileSync(path.join(uploadsDir, fileName), Buffer.from(base64Data, 'base64'))
	return `uploads/${fileName}`
}

export function writeAtomicFile (destPath, content, { mode, mtimeMs } = {}) {
	const dir = path.dirname(destPath)
	fs.mkdirSync(dir, { recursive: true })
	const tmpPath = `${destPath}.tmp`
	fs.writeFileSync(tmpPath, content, mode ? { mode } : undefined)
	if (mode) fs.chmodSync(tmpPath, mode)
	if (mtimeMs) {
		const sec = mtimeMs / 1000
		fs.utimesSync(tmpPath, sec, sec)
	}
	fs.renameSync(tmpPath, destPath)
	if (mtimeMs) {
		const sec = mtimeMs / 1000
		fs.utimesSync(dir, sec, sec)
	}
}

export function writeTranscript (destPath, meta, turns, mtimeMs) {
	const lines = [JSON.stringify({ type: 'meta', ...meta })]
	for (const turn of turns) {
		lines.push(JSON.stringify(turn))
	}
	writeAtomicFile(destPath, lines.join('\n') + '\n', { mtimeMs })
}
