# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2025-06-04

### Changed

#### Architecture

- Split `write-kanban.ts` (656 lines) into 4 focused mode files: `write-kanban-replace.ts`, `write-kanban-append.ts`, `write-kanban-edit.ts`, `write-kanban-delete.ts`
- Split `state.ts` (260 lines) into focused modules: `state.ts`, `resolve-deps.ts`, `resolve-profile.ts`, `reconstruct.ts`
- Extracted shared utilities into `helpers.ts` (`deduplicateIds`, `deduplicateBy`, `finishMutation`) and `guard.ts` (`requireBoard`, `requireNoBoard`)

#### Code Quality

- Normalized error handling: all tools now throw on validation errors (previously `reject_tasks` returned error results)
- Replaced manual rollback snapshot with `structuredClone` for complete field coverage (fixes missing `currentPhaseIndex`)
- Improved type safety: removed unsafe `as` casts, properly typed `EditSet` interface
- Extracted `groupTasksByStatus` helper to eliminate duplicate grouping logic in `formatting.ts`
- Replaced non-null assertions with type-safe `Map` lookups
- Removed duplicate status computation functions (`unblockDependents`, `computeInitialStatuses`)
- Consolidated test helper files into single `test-helpers.ts`
- Removed stale `create_kanban` from `TOOL_NAMES`

### Added

#### Testing

- Integration/lifecycle tests (5 scenarios)
- Message renderer tests for kanban-context
- `renderCall` tests for `claim_tasks`, `reject_tasks`, `list_kanban`
- Malformed JSON settings test
- Fixed `reconstructState` test bug (non-message entry ordering)
- Test count: 295 → 304

#### Admin

- LICENSE (MIT)
- CHANGELOG.md
- `docs/` directory
