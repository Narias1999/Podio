# Race Management App — User Stories Index

Stories are ordered by build dependency. Complete each one before starting the next.

---

## Foundation

| # | Story | File |
|---|---|---|
| 01 | Database schema & types | `01-database-schema-and-types.md` |
| 02 | Auth & organizer session | `02-auth-and-organizer-session.md` |

## Race management

| # | Story | File |
|---|---|---|
| 03 | Create a race (wizard) | `03-create-race-wizard.md` |
| 04 | Manage stages | `04-manage-stages.md` |
| 05 | Manage categories | `05-manage-categories.md` |

## Rider management

| # | Story | File |
|---|---|---|
| 06 | Manual rider registration | `06-manual-rider-registration.md` |
| 07 | Bulk rider import via CSV | `07-bulk-rider-import.md` |

## Results (manual & CSV)

| # | Story | File |
|---|---|---|
| 08 | Manual results entry | `08-manual-results-entry.md` |
| 09 | Bulk results import via CSV | `09-bulk-results-import.md` |
| 10 | GC aggregation | `10-gc-aggregation.md` |

## Time trial start order

| # | Story | File |
|---|---|---|
| 11 | Generate TT start order | `11-generate-tt-start-order.md` |
| 12 | Manual reorder of TT start list | `12-manual-reorder-tt-start-list.md` |
| 13 | Public start list page | `13-public-start-list-page.md` |

## Public results

| # | Story | File |
|---|---|---|
| 14 | Public results page | `14-public-results-page.md` |

## Offline resilience (shared infrastructure)

| # | Story | File |
|---|---|---|
| 15 | Write queue & offline sync engine | `15-write-queue-offline-sync.md` |
| 16 | Connectivity status indicator | `16-connectivity-status-indicator.md` |

## Live TT tracking

| # | Story | File |
|---|---|---|
| 17 | TT start line view | `17-tt-start-line-view.md` |
| 18 | TT finish line view | `18-tt-finish-line-view.md` |
| 19 | TT classification & real-time results | `19-tt-classification-realtime.md` |

## Live group stage tracking

| # | Story | File |
|---|---|---|
| 20 | Group stage start line view | `20-group-stage-start-line.md` |
| 21 | Group stage finish line view | `21-group-stage-finish-line.md` |
| 22 | Group stage classification & real-time results | `22-group-stage-classification-realtime.md` |

---

## Dependency graph (summary)

```
01 (schema)
└── 02 (auth)
    └── 03 (race wizard)
        ├── 04 (stages)
        └── 05 (categories)
            ├── 06 (manual riders)
            │   └── 07 (bulk riders)
            │       ├── 08 (manual results)
            │       │   └── 09 (bulk results)
            │       └── 10 (GC)
            │           └── 11 (TT start order)
            │               ├── 12 (manual reorder)
            │               └── 13 (public start list)
            └── 14 (public results)
                └── 15 (write queue)
                    └── 16 (connectivity indicator)
                        ├── 17 (TT start line)
                        │   └── 18 (TT finish line)
                        │       └── 19 (TT classification)
                        └── 20 (group start line)
                            └── 21 (group finish line)
                                └── 22 (group classification)
```
