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
hits=$(echo "$files" | grep -v '^scripts/check-no-secrets.sh$' | while read -r f; do [ -f "$f" ] && grep -IlE "$patterns" "$f"; done)
[ -z "$hits" ] && pass "no tracked file contains a key, token, database URL or database host" \
    || fail "possible secret in: $(echo $hits)"

# 3. A personal email address anywhere in tracked files (commit metadata is
#    separate: it uses GitHub's private no-reply address).
#    Lock files are skipped: they list the public contact addresses of
#    open-source package authors.
emails=$(echo "$files" | grep -vE '(composer\.lock|package-lock\.json)$' | while read -r f; do [ -f "$f" ] && grep -IhoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' "$f"; done | sort -u \
    | grep -vE '@(example\.(com|org|test)|anthropic\.com|users\.noreply\.github\.com|laravel\.com)$|^hello@example|^git@github\.com$')
[ -z "$emails" ] && pass "no personal email address in tracked files" \
    || fail "email addresses found: $(echo $emails)"

# 4. The ignore rules themselves.
for path in api/.env api/.env.production web/.env web/.env.local docs/ai-log/raw/x.jsonl web/.vercel/project.json; do
    git check-ignore -q "$path" || { fail "$path is not ignored by Git"; }
done
[ $status -eq 0 ] && pass "environment files, raw transcripts and host link files are ignored by Git"

# 5. Nothing private is baked into the production image.
grep -q '^\.env$' api/.dockerignore && grep -q '^\.env\.\*$' api/.dockerignore \
    && pass "environment files are excluded from the Docker image" \
    || fail "api/.dockerignore does not exclude .env files"

exit $status
