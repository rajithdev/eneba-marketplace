# AI conversation history

The assignment requires the full AI conversation, prompts and responses.
This folder holds it. The list of sessions is in [INDEX.md](INDEX.md).

## What is kept

| | Where | What it is |
|---|---|---|
| Original transcripts | `raw/` | Byte-for-byte copies of the files Claude Code itself records for each session, including subagent transcripts and saved tool output. The source of truth. |
| Readable copies | `YYYY-MM-DD-<session>.md` | One Markdown file per session, generated from the originals. Every prompt and every response verbatim; each tool call summarised on one line. |

Both are produced by one command, which is safe to run as often as wanted:

```bash
make ai-log
```

## How loss is prevented

- The Markdown is never written by hand or from memory. It is regenerated
  from the original transcript each time, so it cannot drift from what was
  actually said.
- A raw copy is only ever replaced by a longer version of the same file.
  If an original ever shrinks or changes, the earlier copy is kept beside it
  under a `.superseded-<time>` name instead of being overwritten.
- Claude Code deletes its own old transcripts after a retention period. Once
  a session has been copied here, it stays here even after that happens.
- The command is run at the end of every working session.

## What the readable copies leave out

They show what was said. They do not show full tool inputs and outputs, the
model's private reasoning, or the context the app adds automatically. All of
that remains in `raw/`.

## Why `raw/` is not in the public repository

The original transcripts contain details about the machine they were recorded
on that have nothing to do with this project: the account email address,
names of unrelated personal files, and names of other projects' containers.
`raw/` is therefore listed in `.gitignore` and stays on the author's machine.
The command warns if a readable copy contains an email address, so that can
be reviewed before it is committed.

Sessions that started outside this project folder are listed in
`sessions.json` so the command can find them.
