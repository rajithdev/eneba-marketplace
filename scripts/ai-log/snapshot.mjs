#!/usr/bin/env node
// Preserves the AI conversation history for this project.
//
//   node scripts/ai-log/snapshot.mjs
//
// It does two things, in this order:
//
//   1. RAW COPY. Copies the original Claude Code session transcripts (the
//      .jsonl files Claude Code writes itself, plus subagent transcripts and
//      saved tool output) into docs/ai-log/raw/, byte for byte. These are the
//      source of truth. A copy is never deleted and never replaced by a
//      shorter or different file: if the original ever shrinks or diverges,
//      the previous copy is kept alongside under a ".superseded-<time>" name.
//
//   2. READABLE COPY. Generates one Markdown file per session in docs/ai-log/
//      with every user prompt and every assistant response verbatim, and each
//      tool call summarised on one line. It is always regenerated from the raw
//      copy, never edited by hand.
//
// Private text unrelated to the project (for example the name of a personal
// folder that appears in a file path) can be listed in
// docs/ai-log/redactions.local.json. That file is never committed. Each listed
// string is replaced in the readable copies only, the header of each copy says
// how many replacements were made, and the raw copy is left untouched.
//
// Which sessions are included: every session Claude Code recorded for this
// project folder, plus any ids listed in docs/ai-log/sessions.json (used for
// sessions that began in another folder before this project existed).
//
// No dependencies; needs only Node 20+.

import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  closeSync, readdirSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const logDir = join(projectRoot, 'docs', 'ai-log')
const rawDir = join(logDir, 'raw')
const claudeProjects = join(homedir(), '.claude', 'projects')

// ---------------------------------------------------------------- locate ---

/** Claude Code names a project's transcript folder after its path. */
function slugFor(path) {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

function findSessions() {
  const found = new Map() // session id -> absolute path of its .jsonl

  const ownDir = join(claudeProjects, slugFor(projectRoot))
  if (existsSync(ownDir)) {
    for (const name of readdirSync(ownDir)) {
      if (name.endsWith('.jsonl')) found.set(name.slice(0, -6), join(ownDir, name))
    }
  }

  const listFile = join(logDir, 'sessions.json')
  const listed = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')).sessions : []
  for (const { id } of listed) {
    if (found.has(id)) continue
    for (const dir of existsSync(claudeProjects) ? readdirSync(claudeProjects) : []) {
      const candidate = join(claudeProjects, dir, `${id}.jsonl`)
      if (existsSync(candidate)) found.set(id, candidate)
    }
  }

  // Sessions whose original is gone (Claude Code deletes old transcripts
  // after a retention period) still exist in our raw copy: keep them listed.
  if (existsSync(rawDir)) {
    for (const id of readdirSync(rawDir)) {
      if (!found.has(id) && existsSync(join(rawDir, id, `${id}.jsonl`))) found.set(id, null)
    }
  }

  return found
}

// -------------------------------------------------------------- raw copy ---

function hashOfFirstBytes(path, length) {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  let remaining = length
  while (remaining > 0) {
    const read = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null)
    if (read === 0) break
    hash.update(buffer.subarray(0, read))
    remaining -= read
  }
  closeSync(fd)
  return hash.digest('hex')
}

/**
 * Copy `source` over `target` only when that cannot lose anything: the target
 * is missing, or the source is the target plus more data appended (transcripts
 * are append-only). Otherwise the old copy is kept under another name.
 */
function copyWithoutLoss(source, target) {
  mkdirSync(dirname(target), { recursive: true })

  if (existsSync(target)) {
    const oldSize = statSync(target).size
    const newSize = statSync(source).size
    if (newSize === oldSize && hashOfFirstBytes(source, newSize) === hashOfFirstBytes(target, oldSize)) {
      return 'unchanged'
    }
    const isAppendOnlyGrowth =
      newSize > oldSize && hashOfFirstBytes(source, oldSize) === hashOfFirstBytes(target, oldSize)
    if (!isAppendOnlyGrowth) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(target, `${target}.superseded-${stamp}`)
      copyFileSync(source, target)
      return 'diverged (previous copy kept)'
    }
  }

  copyFileSync(source, target)
  return 'copied'
}

function copyTreeWithoutLoss(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) return
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name)
    const target = join(targetDir, entry.name)
    if (entry.isDirectory()) copyTreeWithoutLoss(source, target)
    else if (entry.isFile()) copyWithoutLoss(source, target)
  }
}

function snapshotRaw(id, sourceFile) {
  const target = join(rawDir, id)
  const result = copyWithoutLoss(sourceFile, join(target, `${id}.jsonl`))
  // Sibling folder: subagent transcripts and large tool outputs.
  copyTreeWithoutLoss(sourceFile.slice(0, -6), join(target, id))
  return result
}

// ------------------------------------------------------------- redaction ---

/** [{ text, replacement }] from the untracked local file, or none. */
function loadRedactions() {
  const file = join(logDir, 'redactions.local.json')
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8')).redactions.filter((entry) => entry.text)
}

/**
 * Private text is replaced in two ways. The local list names strings that
 * are private to the author (a personal folder name). And one rule needs
 * no list: this computer's account name, which is part of every file path
 * recorded on it and says nothing about the project.
 */
function redact(markdown, redactions) {
  let count = 0
  const accountName = userInfo().username
  const rules = [...redactions, ...(accountName.length >= 3 ? [{ text: accountName, replacement: '[redacted: account name]' }] : [])]

  for (const { text, replacement = '[redacted]' } of rules) {
    const parts = markdown.split(text)
    count += parts.length - 1
    markdown = parts.join(replacement)
  }
  return { markdown, count }
}

// ------------------------------------------------------------- read jsonl ---

function readJsonl(path) {
  const records = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // A line still being written when we copied it. The raw copy keeps it.
    }
  }
  return records
}

function tidyPath(path) {
  if (typeof path !== 'string') return ''
  if (path.startsWith(projectRoot)) return relative(projectRoot, path) || '.'
  return path.replace(homedir(), '~')
}

function oneLine(text, max = 140) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** One human-readable line per tool call. The full input is in the raw copy. */
function describeToolCall(name, input = {}) {
  const short = name.replace(/^mcp__/, '').replace(/__/g, ' › ')
  if (name === 'Bash') return `Ran a command: ${oneLine(input.description || input.command)}`
  if (name === 'Read') return `Read \`${tidyPath(input.file_path)}\``
  if (name === 'Write') return `Wrote \`${tidyPath(input.file_path)}\``
  if (name === 'Edit') return `Edited \`${tidyPath(input.file_path)}\``
  if (name === 'Agent') return `Delegated to a subagent: ${oneLine(input.description)}`
  if (name === 'ToolSearch') return `Loaded tools: ${oneLine(input.query)}`
  if (name.endsWith('update_plan')) {
    return input.items ? `Set the task list (${input.items.length} steps)` : 'Advanced the task list'
  }
  if (name.endsWith('wrap_up')) return `Recap shown in the app: ${oneLine(input.recap, 400)}`
  const hint = input.description || input.path || input.url || input.query || ''
  return hint ? `${short}: ${oneLine(tidyPath(hint))}` : short
}

function fence(text) {
  const longestRun = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = '`'.repeat(longestRun + 1)
  return `${ticks}text\n${text}\n${ticks}`
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n\n')
}

// ---------------------------------------------------------------- render ---

function renderSession(id, sessionRawDir, redactions) {
  const records = readJsonl(join(sessionRawDir, `${id}.jsonl`))
  const seen = new Set()
  const out = []
  let promptCount = 0
  let responseOpen = false
  let toolRun = []
  let firstTime = null
  let lastTime = null
  const models = new Set()
  let title = null
  const delegated = [] // prompts given to subagents, in order
  let compactions = 0

  const flushTools = () => {
    if (toolRun.length) out.push(toolRun.map((line) => `> - ${line}`).join('\n'), '')
    toolRun = []
  }

  for (const record of records) {
    if (record.type === 'custom-title' && record.customTitle) title = record.customTitle
    if (record.isSidechain) continue
    if (record.uuid) {
      if (seen.has(record.uuid)) continue
      seen.add(record.uuid)
    }
    if (record.timestamp && (record.type === 'user' || record.type === 'assistant')) {
      firstTime ??= record.timestamp
      lastTime = record.timestamp
    }

    // The conversation outgrew what the model can hold at once, and the app
    // replaced the earlier part, in the model's working memory only, with a
    // summary. Nothing was removed from the transcript or from this log;
    // the reader is told where it happened, because the model's later
    // answers rest on that summary rather than on the messages themselves.
    if (record.type === 'system' && record.subtype === 'compact_boundary') {
      flushTools()
      compactions += 1
      out.push(
        `> **Context compacted (${compactions}).** At this point the conversation had grown past what the model can`,
        '> read at once. The app replaced the earlier messages, in the model\'s working memory only, with a summary',
        '> the model wrote. Every prompt and response before this point is above, unchanged. The summary itself is',
        '> in the original transcript and is not reproduced here.',
        '',
      )
      continue
    }

    // A prompt typed by the human. Tool results and system notices are also
    // stored as "user" records, but only real prompts carry origin "human".
    if (record.type === 'user' && record.origin?.kind === 'human') {
      const text = textOf(record.message?.content)
      if (!text.trim()) continue
      flushTools()
      promptCount += 1
      responseOpen = false
      out.push(`## Prompt ${promptCount}`, '', `_${record.timestamp ?? ''}_`, '', fence(text), '')
      continue
    }

    if (record.type === 'assistant') {
      if (record.message?.model) models.add(record.message.model)
      for (const block of record.message?.content ?? []) {
        if (block.type !== 'text' && block.type !== 'tool_use') continue
        if (!responseOpen) {
          out.push(`## Response ${promptCount}`, '')
          responseOpen = true
        }
        if (block.type === 'text' && block.text.trim()) {
          flushTools()
          out.push(block.text.trim(), '')
        }
        if (block.type === 'tool_use') {
          toolRun.push(describeToolCall(block.name, block.input))
          if (block.name === 'Agent' && block.input?.prompt) {
            delegated.push({ description: block.input.description, prompt: block.input.prompt })
          }
        }
      }
    }
  }
  flushTools()

  const subagents = renderSubagents(join(sessionRawDir, id, 'subagents'), delegated)

  const header = [
    `# AI session log: ${title ?? id}`,
    '',
    `- Session id: \`${id}\``,
    `- Tool: Claude Code (desktop app)`,
    `- Model: ${[...models].filter((m) => m !== '<synthetic>').join(', ') || 'unknown'}`,
    `- First message: ${firstTime ?? 'unknown'}`,
    `- Last message: ${lastTime ?? 'unknown'}`,
    `- Prompts: ${promptCount}`,
    '',
    'Generated by `scripts/ai-log/snapshot.mjs` from the original transcript; not edited by hand.',
    'Prompts and responses are verbatim. Each tool call is summarised on one quoted line.',
    'Not shown here, but present in the original transcript: full tool inputs and outputs,',
    "the model's private reasoning, and context the app injects automatically.",
    ...(compactions
      ? [
          '',
          `This session was compacted ${compactions} time(s): when it grew past what the model can read at once, the app`,
          "replaced the earlier messages, in the model's working memory only, with a summary written by the model.",
          'Each place is marked "Context compacted" below. No prompt or response was removed from this log.',
        ]
      : []),
    '',
    '---',
    '',
  ]

  const body = redact([...out, ...subagents].join('\n'), redactions)
  if (body.count) {
    header.splice(
      header.length - 3,
      0,
      '',
      `${body.count} occurrence(s) of private text unrelated to this project were replaced with a "[redacted…]" marker:`,
      "the computer's account name wherever it appears in a file path, and a personal folder name.",
      'Nothing else was changed.',
    )
  }

  return { markdown: [...header, body.markdown].join('\n'), firstTime, lastTime, promptCount, title }
}

/** Subagents are other AI runs the assistant delegated work to. */
function renderSubagents(dir, delegated) {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()
  if (!files.length) return []

  const out = ['---', '', '## Delegated work (subagents)', '']
  for (const file of files) {
    const records = readJsonl(join(dir, file))
    const first = records.find((record) => record.type === 'user')
    const prompt = textOf(first?.message?.content)
    const match = delegated.find((entry) => entry.prompt.trim() === prompt.trim())

    let report = ''
    for (const record of records) {
      if (record.type !== 'assistant') continue
      for (const block of record.message?.content ?? []) {
        if (block.type === 'text' && block.text.trim()) report = block.text
        if (block.type === 'tool_use' && /handback/i.test(block.name)) {
          const strings = Object.values(block.input ?? {}).filter((value) => typeof value === 'string')
          report = strings.sort((a, b) => b.length - a.length)[0] ?? report
        }
      }
    }

    out.push(
      `### ${match?.description ?? file.replace('.jsonl', '')}`,
      '',
      '**Prompt written by the assistant**',
      '',
      fence(prompt.trim()),
      '',
      '**Report returned**',
      '',
      fence(report.trim() || '(no report recorded)'),
      '',
    )
  }
  return out
}

// ------------------------------------------------------------------ main ---

mkdirSync(rawDir, { recursive: true })

const sessions = findSessions()
const redactions = loadRedactions()
const index = []

for (const [id, sourceFile] of sessions) {
  const status = sourceFile ? snapshotRaw(id, sourceFile) : 'original gone, using preserved copy'
  const rendered = renderSession(id, join(rawDir, id), redactions)
  const fileName = `${(rendered.firstTime ?? 'undated').slice(0, 10)}-${id.slice(0, 8)}.md`
  writeFileSync(join(logDir, fileName), rendered.markdown)

  // The readable copies are published. Flag any email address that slipped in
  // so it can be looked at before committing.
  const emails = new Set(rendered.markdown.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])
  for (const email of emails) {
    if (!/(@example\.com|@anthropic\.com|@users\.noreply\.github\.com)$/.test(email)) {
      console.warn(`  WARNING: ${fileName} contains an email address (${email}). Review before publishing.`)
    }
  }
  index.push({ id, fileName, ...rendered, status })
  console.log(`${id}  raw: ${status}  ->  docs/ai-log/${fileName}  (${rendered.promptCount} prompts)`)
}

index.sort((a, b) => String(a.firstTime).localeCompare(String(b.firstTime)))

const table = index
  .map((s, i) => `| ${i + 1} | [${s.fileName}](${s.fileName}) | ${s.title ?? ''} | ${(s.firstTime ?? '').slice(0, 16).replace('T', ' ')} | ${s.promptCount} |`)
  .join('\n')

writeFileSync(
  join(logDir, 'INDEX.md'),
  `# AI session index\n\nGenerated by \`scripts/ai-log/snapshot.mjs\`. Times are UTC.\n\n| # | Log | Title | Started | Prompts |\n|---|---|---|---|---|\n${table}\n`,
)

if (!index.length) console.log('No sessions found.')
