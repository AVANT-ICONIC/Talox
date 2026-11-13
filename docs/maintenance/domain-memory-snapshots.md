# DomainMemory Snapshot Isolation

## Overview

DomainMemory persistence snapshots must be completely isolated from mutable strategy records to prevent unintended side effects between exported/imported data and live adaptation scores.

## Problem Statement

Previously, `DomainMemory.toJSON()` and `fromJSON()` used shallow copying of strategy records, which meant:

- Mutating an exported score would change the original memory's live data
- Recording outcomes after export would mutate earlier exported snapshots  
- Importing the same snapshot into multiple memories would share mutable state
- Changes to one imported instance would affect all other instances

This violated the principle that persistence boundaries should be immutable snapshots of state at a point in time.

## Solution

### Serialization Boundaries

Both `toJSON()` and `fromJSON()` now perform deep copying of `StrategyScore` objects using `structuredClone()`:

```typescript
// toJSON() - deep copy strategy scores
const strategies: Record<string, StrategyScore> = {};
for (const [strategyName, score] of Object.entries(v.strategies)) {
    strategies[strategyName] = structuredClone(score);
}

// fromJSON() - deep copy strategy scores  
const strategies: Record<string, StrategyScore> = {};
for (const [strategyName, score] of Object.entries(record.strategies)) {
    strategies[strategyName] = structuredClone(score);
}
```

### Isolation Guarantees

1. **Export Isolation**: Mutating exported scores does not affect original memory
2. **Temporal Isolation**: Recording after export does not mutate earlier snapshots
3. **Import Isolation**: Multiple instances from the same snapshot are independent
4. **Cross-Instance Isolation**: Updating one imported memory does not affect others

## Testing

Comprehensive tests verify all isolation scenarios:

- `mutating an exported score does not affect original memory`
- `recording after export does not mutate earlier exported snapshot`
- `mutating imported source map and score does not affect other instances`
- `importing one snapshot into two memories and updating one does not affect the other`
- `multiple snapshots from the same source remain independent`

## Performance Considerations

- Deep copying uses `structuredClone()` which is optimized for structured data
- For 1,000 small synthetic records: target <50ms CPU and <10MiB incremental heap
- Synchronous transformations remain linear in records/keys
- No added background timers, polling, or network I/O
- Single-operation I/O preserved for persistence operations

## API Compatibility

- Version 1 shape maintained
- All existing APIs unchanged
- EWMA math preserved
- No breaking changes to public interface

## Usage Examples

```typescript
// Export isolated snapshot
const memory = new DomainMemory();
memory.record("https://example.com", "strategy_a", true);
const snapshot = memory.toJSON(); // Deep copy created

// Mutate snapshot - original unaffected
snapshot.domains["example.com"].strategies["strategy_a"].attempts = 999;
console.log(memory.getScore("https://example.com", "strategy_a")?.attempts); // 1

// Import to multiple independent instances
const memory1 = new DomainMemory();
const memory2 = new DomainMemory();
memory1.fromJSON(snapshot);
memory2.fromJSON(snapshot);

// Update one - other unaffected
memory1.record("https://example.com", "strategy_a", false);
console.log(memory2.getScore("https://example.com", "strategy_a")?.attempts); // 1
```

## Migration

No migration required. Existing code continues to work with improved isolation guarantees.

## Future Considerations

- If version 2 is introduced, maintain backward compatibility for version 1
- Consider performance optimizations for very large datasets if needed
- Monitor memory usage with real-world data volumes