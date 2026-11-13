# Session Snapshot Origin Validation

## Overview

This document describes the origin validation added to `SessionSnapshot` to prevent cross-origin storage attacks during session restoration.

## Problem Statement

Previously, `restoreSessionSnapshot` only checked if the captured URL started with "http" before restoring localStorage and sessionStorage. This created a security vulnerability where:

1. A navigation failure or redirect could leave the page on a different origin
2. The captured storage would still be restored to the wrong origin
3. This could lead to cross-origin data leaks or injection attacks

## Solution

### Origin Validation Logic

The implementation adds strict origin validation:

1. **URL Parsing**: Only HTTP and HTTPS URLs are considered valid for storage operations
2. **Origin Comparison**: Captured and current URLs must match in:
   - Scheme (http vs https)
   - Host (domain/subdomain)
   - Port (explicit or default: 80 for http, 443 for https)
3. **Fail-Closed Behavior**: If origins don't match, storage restoration is silently skipped
4. **Error Handling**: Malformed URLs or storage errors are handled gracefully

### Key Functions

#### `parseOrigin(url: string): string | null`

Parses a URL and returns its origin in the format `scheme://host:port`. Returns `null` for:
- Non-HTTP(S) schemes (chrome://, file://, etc.)
- Malformed URLs
- Opaque URLs (about:blank, javascript:, etc.)

#### `sameOrigin(url1: string, url2: string): boolean`

Compares two URLs and returns `true` only if they have identical origins including scheme, host, and port.

## Behavior Examples

### ✅ Allowed (Same Origin)

```typescript
// Captured from: https://example.com/dashboard
// Current page: https://example.com/dashboard
// Result: Storage RESTORED

// Captured from: https://example.com/login  
// Current page: https://example.com/dashboard (after redirect)
// Result: Storage RESTORED (same origin)
```

### ❌ Blocked (Different Origins)

```typescript
// Captured from: https://auth.example.com/login
// Current page: https://example.com/dashboard (cross-origin redirect)
// Result: Storage SKIPPED (different hosts)

// Captured from: https://example.com:8443/dashboard
// Current page: https://example.com:3000/dashboard (different ports)  
// Result: Storage SKIPPED (different ports)

// Captured from: http://example.com/dashboard
// Current page: https://example.com/dashboard (different schemes)
// Result: Storage SKIPPED (different schemes)
```

### 🚫 Invalid URLs

```typescript
// Captured from: chrome://newtab/
// Current page: https://example.com
// Result: Storage SKIPPED (invalid captured URL)

// Captured from: https://example.com
// Current page: chrome://newtab/
// Result: Storage SKIPPED (invalid current URL)
```

## Test Coverage

The comprehensive test suite covers:

1. **Origin Validation Tests**
   - URL parsing for various schemes and ports
   - Origin comparison logic edge cases
   - Invalid URL handling

2. **Restore Function Tests**
   - Same-origin restoration (should work)
   - Cross-origin blocking (should skip)
   - Scheme mismatches
   - Port mismatches  
   - Host mismatches
   - Navigation failure scenarios
   - Malformed URL handling
   - Storage quota errors

3. **Integration Tests**
   - Backward compatibility for valid cases
   - Fail-closed behavior for edge cases
   - Error handling without throwing

## Security Considerations

### Fail-Closed Design
- When origin validation fails, storage restoration is skipped entirely
- This prevents potential cross-origin attacks but may lose intended state
- The trade-off prioritizes security over functionality in ambiguous cases

### Race Conditions
- Origin validation happens immediately before each storage write
- This prevents "time-of-check vs time-of-use" races during navigation
- The current page URL is checked at the moment of storage restoration

### Error Handling
- Storage operations that fail (quota exceeded, etc.) are caught and ignored
- Invalid URLs don't throw exceptions, they simply skip storage operations
- Navigation failures are handled gracefully without breaking the restore flow

## Performance Impact

- **Minimal Overhead**: Origin parsing and comparison is O(1) and synchronous
- **No Network I/O**: All validation happens in-process
- **No Additional Timers**: No polling or background operations
- **Linear Scaling**: Performance remains constant regardless of storage size

## Migration Notes

### Backward Compatibility
- Existing valid use cases continue to work unchanged
- Only invalid cross-origin scenarios are now blocked
- No API changes required

### Breaking Changes
- Cross-origin storage restoration that was previously allowed is now blocked
- This is a security fix, not a breaking change in functionality
- Applications relying on cross-origin storage will need to redesign their approach

## Future Considerations

### Potential Enhancements
1. **Explicit Allowlists**: Optional per-origin allowlists for trusted cross-domain scenarios
2. **Logging**: Debug logging for blocked storage operations
3. **Partial Restoration**: Selective restoration of non-sensitive storage items
4. **User Confirmation**: Interactive prompts for cross-origin restoration

### Alternative Approaches
1. **Content Security Policy Integration**: Could leverage existing CSP rules
2. **Permission API**: Use browser permissions for cross-origin storage access
3. **Origin Whitelisting**: Configurable list of allowed cross-origin pairs

## Implementation Details

The implementation uses the browser's native URL parsing and comparison to ensure consistency with web platform behavior. The validation occurs in the critical path of storage restoration, ensuring no cross-origin data can be written unintentionally.