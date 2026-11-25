import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from './firebase';
import {
  clampFirestoreString,
  filePathToDocId,
  parseToolSummary,
  sanitizeFirestoreId,
  summarizeToolTraces,
} from './firebase-helpers';
import type { DesktopLayoutMode, SurfaceRadius, UiDesignId } from './themes';
import type { ChatMessage, McpServerPublicView, ThinkingDepth } from './types';

export interface UserPreferences {
  designId: UiDesignId;
  surfaceRadius: SurfaceRadius;
  editorFontSize: number;
  layoutMode: DesktopLayoutMode;
  thinkingLevel: ThinkingDepth;
}

function resolveAuthProvider(user: User): 'password' | 'google' | 'other' {
  const providerId = user.providerData?.[0]?.providerId || '';
  if (providerId === 'password') return 'password';
  if (providerId === 'google.com') return 'google';
  return 'other';
}

export async function ensureUserProfileDoc(
  user: User,
  defaults: UserPreferences,
): Promise<UserPreferences> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const payload = {
        uid: user.uid,
        email: clampFirestoreString(user.email || '', 320),
        displayName: clampFirestoreString(
          user.displayName || user.email?.split('@')[0] || 'Developer',
          120,
        ),
        authProvider: resolveAuthProvider(user),
        designId: defaults.designId,
        surfaceRadius: defaults.surfaceRadius,
        editorFontSize: Math.min(15, Math.max(12, defaults.editorFontSize)),
        layoutMode: defaults.layoutMode,
        thinkingLevel: defaults.thinkingLevel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, payload);
      return defaults;
    }

    const data = snap.data() as Partial<UserPreferences>;
    return {
      designId: (data.designId as UiDesignId) || defaults.designId,
      surfaceRadius: (data.surfaceRadius as SurfaceRadius) || defaults.surfaceRadius,
      editorFontSize:
        typeof data.editorFontSize === 'number' &&
        data.editorFontSize >= 12 &&
        data.editorFontSize <= 15
          ? data.editorFontSize
          : defaults.editorFontSize,
      layoutMode: (data.layoutMode as DesktopLayoutMode) || defaults.layoutMode,
      thinkingLevel: (data.thinkingLevel as ThinkingDepth) || defaults.thinkingLevel,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserPreferencesInFirestore(
  uid: string,
  prefs: Partial<UserPreferences>,
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const updatePayload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (prefs.designId) updatePayload.designId = prefs.designId;
    if (prefs.surfaceRadius) updatePayload.surfaceRadius = prefs.surfaceRadius;
    if (typeof prefs.editorFontSize === 'number') {
      updatePayload.editorFontSize = Math.min(15, Math.max(12, prefs.editorFontSize));
    }
    if (prefs.layoutMode) updatePayload.layoutMode = prefs.layoutMode;
    if (prefs.thinkingLevel) updatePayload.thinkingLevel = prefs.thinkingLevel;

    await updateDoc(ref, updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function syncWorkspaceFileToFirestore(
  uid: string,
  relPath: string,
  content: string,
): Promise<void> {
  const clampedPath = clampFirestoreString(relPath.trim(), 260);
  if (!clampedPath || content.length > 195_000) {
    return;
  }
  const fileId = filePathToDocId(clampedPath);
  const path = `users/${uid}/files/${fileId}`;
  const ref = doc(db, 'users', uid, 'files', fileId);

  try {
    const snap = await getDoc(ref);
    const byteSize = Math.min(200_000, new TextEncoder().encode(content).length);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        path: clampedPath,
        content,
        size: byteSize,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        path: clampedPath,
        content,
        size: byteSize,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteWorkspaceFileFromFirestore(uid: string, relPath: string): Promise<void> {
  const fileId = filePathToDocId(relPath);
  const path = `users/${uid}/files/${fileId}`;
  const ref = doc(db, 'users', uid, 'files', fileId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function fetchUserCloudFiles(
  uid: string,
): Promise<Array<{ path: string; content: string }>> {
  const collectionPath = `users/${uid}/files`;
  try {
    const q = query(collection(db, 'users', uid, 'files'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as { path?: string; content?: string })
      .filter((d): d is { path: string; content: string } => typeof d.path === 'string' && typeof d.content === 'string');
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, collectionPath);
  }
}

export function subscribeUserMessages(
  uid: string,
  onMessages: (messages: ChatMessage[]) => void,
): () => void {
  const collectionPath = `users/${uid}/messages`;
  const q = query(collection(db, 'users', uid, 'messages'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as {
          role?: 'user' | 'assistant';
          content?: string;
          thinkingLevel?: ThinkingDepth;
          toolSummary?: string;
          error?: string;
          createdAt?: Timestamp | null;
        };
        const createdAtIso = data.createdAt?.toDate
          ? data.createdAt.toDate().toISOString()
          : new Date().toISOString();
        const createdMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;

        return {
          createdMs,
          msg: {
            id: docSnap.id,
            role: data.role === 'assistant' ? 'assistant' : 'user',
            content: data.content || '',
            thinkingLevel: data.thinkingLevel,
            toolTraces: parseToolSummary(data.toolSummary),
            error: data.error || undefined,
            timestamp: createdAtIso,
          } satisfies ChatMessage,
        };
      });

      items.sort((a, b) => a.createdMs - b.createdMs || a.msg.id.localeCompare(b.msg.id));
      onMessages(items.map((i) => i.msg));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, collectionPath);
    },
  );
}

export async function saveChatMessageToFirestore(uid: string, message: ChatMessage): Promise<void> {
  const messageId = sanitizeFirestoreId(message.id);
  const path = `users/${uid}/messages/${messageId}`;
  const ref = doc(db, 'users', uid, 'messages', messageId);

  try {
    await setDoc(ref, {
      ownerId: uid,
      role: message.role,
      content: clampFirestoreString(message.content || '', 32000),
      thinkingLevel: message.thinkingLevel || 'HIGH',
      toolSummary: summarizeToolTraces(message.toolTraces),
      error: clampFirestoreString(message.error || '', 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function clearUserChatHistory(uid: string): Promise<void> {
  const collectionPath = `users/${uid}/messages`;
  try {
    const q = query(collection(db, 'users', uid, 'messages'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, collectionPath);
  }
}

export async function syncMcpBookmarksToFirestore(
  uid: string,
  servers: McpServerPublicView[],
): Promise<void> {
  for (const srv of servers.slice(0, 20)) {
    const serverId = sanitizeFirestoreId(srv.id);
    const path = `users/${uid}/mcpServers/${serverId}`;
    const ref = doc(db, 'users', uid, 'mcpServers', serverId);
    try {
      const snap = await getDoc(ref);
      const commonFields = {
        name: clampFirestoreString(srv.name, 120),
        description: clampFirestoreString(srv.description || '', 500),
        transport: srv.transport,
        endpointUrl: clampFirestoreString(srv.endpointUrl, 500),
        authType: srv.auth.type,
        enabled: Boolean(srv.enabled),
        lastStatus: srv.status,
        toolCount: Math.min(500, Math.max(0, srv.tools.length)),
        updatedAt: serverTimestamp(),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          ownerId: uid,
          serverId,
          ...commonFields,
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, commonFields);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}
