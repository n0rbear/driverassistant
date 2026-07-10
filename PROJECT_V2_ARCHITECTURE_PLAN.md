Update PROJECT_V2_ARCHITECTURE_PLAN.md to reflect the current implementation state.

Do NOT rewrite the architecture.

Instead update the document to distinguish:

- Planned
- Implemented
- Remaining

The document must accurately describe the current system.

==================================================

IMPLEMENTED

Sprint 1

✓ UUID Foundation

- UUID added to every entity.
- RFC-4122 compliant UUID generation.
- UUID migration completed.
- Existing databases migrate safely.

✓ Backend UUID support

- PostgreSQL UUID columns.
- Existing API returns UUIDs.
- Existing numeric IDs preserved.

✓ Merge Synchronization

- Wipe-and-Replace removed.
- UUID-aware Merge implemented.
- Numeric IDs remain stable.
- Stops preserve Tour relationship.

✓ Soft Delete

- deleted_at implemented.
- Android propagates deletions.
- Backend propagates deletions.
- UI hides deleted records.

✓ Web ↔ Android synchronization

Working:

- Create Tour
- Edit Tour
- Delete Tour
- Add Stop
- Delete Stop

✓ Automatic synchronization

Android

- Push → Pull sequence
- Manual refresh
- Auto refresh every 60 seconds
- Sync on screen open

✓ Web UX

- Active tab persistence
- Refresh keeps current tab

==================================================

KNOWN REMAINING ISSUES

- Editing an existing Stop (address modification) still fails and is under investigation.
- Expense synchronization is still V1.
- Dashboard still calculates incorrect statistics.
- Driver/Profile management is still V1.
- QR pairing not implemented.
- PDF import is Android-only.
- Web PDF import not implemented.
- Delta Sync not yet implemented.
- Multi-company support not yet implemented.

==================================================

Add a section:

CURRENT PROJECT STATUS

showing

Completed
In Progress
Planned

Do not change future roadmap sections.