# Talox Release Roadmap

> ✅ **Backlog complete — all 36 items resolved.**
> 11 `as any` remain as documented exceptions (CDP protocol, browser globals).

## ✅ Done

|Version|Theme|Key Metric|Date|
|---|---|---|---|
|v7.0.2|Package hygiene|npm warnings fixed|2026-05-17|
|v7.0.3|Logger abstraction|12 core modules de-console.log'd|2026-05-17|
|v7.0.4|Typed accessors|13 `as any`→0 in TaloxController|2026-05-17|
|v7.1.0|Type Safety Sprint|49 `page:any`→0, ~70 suppressions killed|2026-05-17|
|v7.1.1|Suppressions cleanup|9 `@ts-expect-error`→2, 14 `!`→0|2026-05-17|
|v7.2.0|Test hardening|+43 tests (1688 total)|2026-05-17|
|v7.3.0|Hard type gaps|7 `as any` killed, 0 `@ts-expect-error`|2026-05-17|
|v7.4.0|Robustness & docs|Backlog complete, chromium→optional|2026-05-17|
|—|CI fixes|3/3 green, concurrency fixed, pre-push lightened|2026-05-20|

## Final Tally

|Metric|Before|After|
|---|---|---|
|`as any` in core|34|**11** (documented)|
|`@ts-expect-error`|11|**0**|
|`page: any`|49|**0**|
|Non-null `!` (research)|14|**0**|
|Console.log in core|6|**0**|
|Test files|79|**93**|
|Tests|1,645|**1,694**|
|CI gates|broken|**3/3 green**|
|Releases|—|**8**|

---

*Original backlog: 36 items across 8 categories. All resolved.*
