# Stroke Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership**: Every document in `/users/{userId}` and its subcollections (`/files/{fileId}`, `/messages/{messageId}`, `/mcpServers/{serverId}`) is strictly owned by `request.auth.uid == userId`. No user can read, list, create, update, or delete another user's records.
2. **Master Gate**: Subcollection creates and updates verify the parent `/users/{userId}` profile document exists and belongs to `request.auth.uid`.
3. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, and `createdAt` are immutable after creation. All `createdAt` and `updatedAt` fields must equal `request.time` on create/update respectively.
4. **No Secret Persistence**: MCP credentials (tokens, API keys, passwords, OAuth client secrets) are never written to Firestore; only non-secret connection metadata (`authType`, `endpointUrl`, `name`, `lastStatus`, `toolCount`) is stored.
5. **Strict Key & Size Bounds**: Every write validates exact required/allowed keys (`hasAll` + `hasOnly`), field types, enum constraints, ID regex (`^[a-zA-Z0-9_\-]+$`), and maximum string/numeric bounds.

## 2. Adversarial "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `get(/users/uid123)` with `request.auth == null`.
2. **Cross-Tenant Profile Read**: `get(/users/alice)` signed in as `bob`.
3. **User Enumeration**: `list(/users)` signed in as any user.
4. **Shadow Field Injection on Profile Create**: `create(/users/alice)` with extra `{ isAdmin: true }`.
5. **Cross-Tenant File Write**: `create(/users/alice/files/f1)` with `ownerId: "bob"` signed in as `bob`.
6. **Impersonation Owner Spoof**: `create(/users/bob/files/f1)` with `ownerId: "alice"` signed in as `bob`.
7. **ID Poisoning**: `create(/users/bob/files/../../../etc/passwd)` or a 200-char invalid ID.
8. **Timestamp Backdating**: `create(/users/bob/messages/m1)` with client-chosen `createdAt` instead of `request.time`.
9. **Immutable Owner Tampering**: `update(/users/bob/files/f1)` changing `ownerId` from `"bob"` to `"alice"`.
10. **Denial-of-Wallet Oversized String**: `create(/users/bob/messages/m1)` with `content.size() > 32000`.
11. **Invalid Enum Injection**: `update(/users/bob)` setting `designId: "custom_xss"`.
12. **Orphaned Subcollection Write**: `create(/users/bob/files/f1)` when `/users/bob` parent doc does not exist.
