#!/bin/sh
# Fails if anything that must stay private is tracked by Git or about to be
# committed. Run before every push:  make audit
#
# It checks three things:
#   1. no environment files, key files or raw AI transcripts are tracked;
#   2. no tracked file contains something shaped like a real secret;
#   3. the files that must be ignored really are ignored.
cd "$(dirname "$0")/.."
status=0
fail() { echo "FAIL  $1"; status=1; }
pass() { echo "PASS  $1"; }

# Everything Git tracks, plus anything staged for the next commit.
files=$( (git ls-files; git diff --cached --name-only --diff-filter=A) | sort -u)

# 1. Files that must never be tracked. ".env.example" files are templates
#    without real values and are allowed.
forbidden=$(echo "$files" | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|(^|/)auth\.json$|^docs/ai-log/raw/|(^|/)\.vercel/|\.jsonl$' | grep -vE '\.env\.example$')
[ -z "$forbidden" ] && pass "no environment files, key files or raw transcripts are tracked" \
    || fail "these files must not be tracked: $(echo $forbidden)"

# 2. Content shaped like a secret. The patterns need a real value after the
#    name, so documentation that merely mentions "APP_KEY" does not match.
patterns='APP_KEY=base64:[A-Za-z0-9+/]{20,}|base64:[A-Za-z0-9+/]{43}=|postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@|npg_[A-Za-z0-9]{10,}|rnd_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|sk_live_[A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ep-[a-z]+-[a-z]+-[a-z0-9]{6,}[a-z0-9.-]*\.neon\.tech'
# Known harmless matches: the made-up host name used in Neon's own
# documentation, which the AI log quotes from a research report.
allowed='ep-cool-darkness-a1b2c3d4'
hits=$(echo "$files" | grep -v '^scripts/check-no-secrets.sh$' | while read -r f; do
    [ -f "$f" ] && grep -IoE "$patterns" "$f" | grep -vF "$allowed" | grep -q . && echo "$f"
done)
[ -z "$hits" ] && pass "no tracked file contains a key, token, database URL or database host" \
    || fail "possible secret in: $(echo $hits)"

# 3. A personal email address anywhere in tracked files (commit metadata is
#    separate: it uses GitHub's private no-reply address).
#    Lock files are skipped: they list the public contact addresses of
#    open-source package authors.
#    A log file of a versioned Homebrew package ("postgresql@14.log") has
#    the same shape and is not an address: nothing after its "@" but a
#    version number and ".log", which is not a mail domain.
emails=$(echo "$files" | grep -vE '(composer\.lock|package-lock\.json)$' | while read -r f; do [ -f "$f" ] && grep -IhoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' "$f"; done | sort -u \
    | grep -vE '@(example\.(com|org|test)|anthropic\.com|users\.noreply\.github\.com|laravel\.com)$|^hello@example|^git@github\.com$|@[0-9.]+\.log$')
[ -z "$emails" ] && pass "no personal email address in tracked files" \
    || fail "email addresses found: $(echo $emails)"

# 3b. Text listed for removal from the AI logs must not appear in any tracked file.
if [ -f docs/ai-log/redactions.local.json ]; then
    leaked=$(node -e '
        const fs = require("fs");
        const terms = JSON.parse(fs.readFileSync("docs/ai-log/redactions.local.json", "utf8")).redactions.map((r) => r.text);
        const files = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
        const hits = files.filter((f) => fs.existsSync(f) && fs.statSync(f).isFile() && terms.some((t) => fs.readFileSync(f).includes(t)));
        console.log(hits.join(" "));
    ' <<LIST
$files
LIST
)
    [ -z "$leaked" ] && pass "no tracked file contains text marked private for the AI log" \
        || fail "private text found in: $leaked"
fi

# 3c. This computer's account name is part of every local file path
#     (/Users/<name>/...). The AI log replaces it; nothing tracked may carry it.
account=$(id -un)
if [ "${#account}" -ge 3 ]; then
    named=$(echo "$files" | while read -r f; do [ -f "$f" ] && grep -IlF "/Users/$account" "$f"; done)
    [ -z "$named" ] && pass "no tracked file contains this computer's account name in a path" \
        || fail "account name in a path in: $(echo $named)"
fi

# 4. The ignore rules themselves.
for path in api/.env api/.env.production web/.env web/.env.local docs/ai-log/raw/x.jsonl docs/ai-log/redactions.local.json web/.vercel/project.json; do
    git check-ignore -q "$path" || { fail "$path is not ignored by Git"; }
done
[ $status -eq 0 ] && pass "environment files, raw transcripts and host link files are ignored by Git"

# 5. Nothing private is baked into the production image.
grep -q '^\.env$' api/.dockerignore && grep -q '^\.env\.\*$' api/.dockerignore \
    && pass "environment files are excluded from the Docker image" \
    || fail "api/.dockerignore does not exclude .env files"

exit $status
