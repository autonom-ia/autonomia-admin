#!/usr/bin/env bash
# pre-tool-use.sh — observes tool calls; blocks only catastrophic patterns in strict mode
# Called by Claude Code runtime before every tool call.
# stdin: JSON { "tool_name": "...", "tool_input": { ... } }
# Behavior depends on enforcement_mode in platform-manifest.json:
#   "warn" (default): stderr message but exit 0 — Claude proceeds
#   "strict": exit 1 on BLOCKED patterns — Claude is blocked
# CATASTROPHIC patterns (always exit 1, regardless of mode):
#   - recursive forced deletion whose target is exactly / or /*
#   - "DROP DATABASE"  (only blocked literally; ALTER/DROP TABLE are warn)
#   - "destroyService"  (Easypanel destroy, irreversible)
# Everything else is observability: log to stderr, exit 0.

set -uo pipefail

input=$(cat)

# Empty stdin = no tool call data; exit 0 (warn mode default — don't block on missing data)
if [ -z "$input" ]; then
  echo "INFO: pre-tool-use received empty stdin" >&2
  exit 0
fi

tool_input=$(echo "$input" | jq -r 'tostring' 2>/dev/null || echo "$input")
command_text=$(echo "$input" | jq -r '
  if (.tool_input | type) == "object" then
    .tool_input.command // .tool_input.cmd // empty
  else
    empty
  end
' 2>/dev/null || true)
if [ -z "$command_text" ]; then
  command_text="$tool_input"
fi

# Read enforcement_mode (default: warn)
mode="warn"
if [ -f "platform-manifest.json" ]; then
  mode=$(jq -r '.enforcement_mode // "warn"' platform-manifest.json 2>/dev/null || echo "warn")
fi

# CATASTROPHIC — always block, even in warn mode
CATASTROPHIC=(
  "DROP DATABASE"
  "destroyService"
)

# STRICT-only block patterns (warn in warn mode)
STRICT_BLOCK=(
  "DROP TABLE"
  "TRUNCATE"
  "deleteService"
  "push --force" "push -f"
  "reset --hard"
  "clean -fd"
  " wipe " " purge "
)

# Always warn (never block)
WARN_PATTERNS=(
  "production" "prod/"
  "\.env"
  "secret" "credential" "token" "password" "api.key" "apikey"
  "billing" "ALTER TABLE" "migrate"
)

# Root deletion needs a token boundary. A substring check for "rm -rf /" also
# matches safe temporary targets such as /tmp/build and must not be used.
root_rm_is_catastrophic() {
  local fragment token clean_token executable_name
  local saw_rm recursive force root_target
  local -a fragment_tokens

  while IFS= read -r fragment; do
    saw_rm="false"
    recursive="false"
    force="false"
    root_target="false"

    read -r -a fragment_tokens <<< "$fragment"
    for token in "${fragment_tokens[@]}"; do
      clean_token="${token//\'/}"
      clean_token="${clean_token//\"/}"
      clean_token="${clean_token#\\}"

      if [ "$saw_rm" = "false" ]; then
        executable_name="${clean_token##*/}"
        if [ "$executable_name" = "rm" ]; then
          saw_rm="true"
        fi
        continue
      fi

      case "$clean_token" in
        --recursive) recursive="true" ;;
        --force) force="true" ;;
        --) ;;
        -*)
          case "${clean_token#-}" in *[rR]*) recursive="true" ;; esac
          case "${clean_token#-}" in *f*) force="true" ;; esac
          ;;
        *)
          if echo "$clean_token" | grep -Eq '^/+$|^/+\*$'; then
            root_target="true"
          fi
          ;;
      esac
    done

    if [ "$saw_rm" = "true" ] && [ "$recursive" = "true" ] &&
      [ "$force" = "true" ] && [ "$root_target" = "true" ]; then
      return 0
    fi
  done < <(echo "$command_text" | tr ';&|' '\n')
  return 1
}

if root_rm_is_catastrophic; then
  echo "BLOCKED (catastrophic): recursive forced deletion targets the filesystem root." >&2
  exit 1
fi

# Other catastrophic checks — always block
for pattern in "${CATASTROPHIC[@]}"; do
  if echo "$tool_input" | grep -qiF "$pattern"; then
    echo "BLOCKED (catastrophic): input contains '$pattern'. Requires explicit Rodrigo approval." >&2
    exit 1
  fi
done

# Strict-only block check
if [ "$mode" = "strict" ]; then
  for pattern in "${STRICT_BLOCK[@]}"; do
    if echo "$tool_input" | grep -qiF "$pattern"; then
      echo "BLOCKED (strict mode): input matches '$pattern'. Set enforcement_mode='warn' to allow." >&2
      exit 1
    fi
  done
else
  # In warn mode, strict patterns just become warnings
  for pattern in "${STRICT_BLOCK[@]}"; do
    if echo "$tool_input" | grep -qiF "$pattern"; then
      echo "WARN (warn mode): input matches '$pattern' — would block in strict mode." >&2
    fi
  done
fi

# Always-warn patterns (informational only)
for pattern in "${WARN_PATTERNS[@]}"; do
  if echo "$tool_input" | grep -qiF "$pattern"; then
    echo "INFO: input touches '$pattern' — verify this is safe." >&2
  fi
done

exit 0
