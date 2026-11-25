import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { AssistantPanel } from './components/AssistantPanel';
import { AuthGate } from './components/AuthGate';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import { DesignsView } from './components/DesignsView';
import { FileExplorer } from './components/FileExplorer';
import { McpServersView } from './components/McpServersView';
import { MobileBottomNav, type MobilePane } from './components/MobileBottomNav';
import { SecurityAuthView } from './components/SecurityAuthView';
import { TerminalPanel } from './components/TerminalPanel';
import { TopBar, type ActiveView } from './components/TopBar';
import { auth } from './lib/firebase';
import {
  clearUserChatHistory,
  deleteWorkspaceFileFromFirestore,
  ensureUserProfileDoc,
  fetchUserCloudFiles,
  saveChatMessageToFirestore,
  subscribeUserMessages,
  syncMcpBookmarksToFirestore,
  syncWorkspaceFileToFirestore,
  updateUserPreferencesInFirestore,
} from './lib/firestore-sync';
import {
  getUiDesign,
  type DesktopLayoutMode,
  type SurfaceRadius,
  type UiDesignId,
} from './lib/themes';
import type {
  AuthStatusResponse,
  ChatMessage,
  McpServerPublicView,
  TerminalEntry,
  ThinkingDepth,
  ToolCallTrace,
  WorkspaceFileNode,
} from './lib/types';
import {
  deleteFile,
  fetchMcpServers,
  hydrateWorkspace,
  listFiles,
  readFile,
  runTerminalCommand,
  saveFile,
  streamAssistantChat,
} from './utils/api';

function readStoredPreference<T extends string>(key: string, fallback: T): T {
  try {
    const val = window.localStorage.getItem(key);
    return (val as T) || fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileReadyUid, setProfileReadyUid] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('workbench');
  const [mobilePane, setMobilePane] = useState<MobilePane>('code');

  // UI Design & layout preferences (synced to Firestore when signed in)
  const [designId, setDesignId] = useState<UiDesignId>(() =>
    readStoredPreference<UiDesignId>('stroke_design', 'obsidian'),
  );
  const [surfaceRadius, setSurfaceRadius] = useState<SurfaceRadius>(() =>
    readStoredPreference<SurfaceRadius>('stroke_radius', 'balanced'),
  );
  const [editorFontSize, setEditorFontSize] = useState<number>(() => {
    const raw = Number(readStoredPreference('stroke_font_size', '13'));
    return raw >= 12 && raw <= 15 ? raw : 13;
  });
  const [layoutMode, setLayoutMode] = useState<DesktopLayoutMode>(() =>
    readStoredPreference<DesktopLayoutMode>('stroke_layout', 'standard'),
  );
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingDepth>('HIGH');

  const prefsRef = useRef({
    designId,
    surfaceRadius,
    editorFontSize,
    layoutMode,
    thinkingLevel,
  });
  prefsRef.current = {
    designId,
    surfaceRadius,
    editorFontSize,
    layoutMode,
    thinkingLevel,
  };
  const skipNextPrefSyncRef = useRef(false);

  useEffect(() => {
    const design = getUiDesign(designId);
    const root = document.documentElement;
    root.setAttribute('data-design', design.id);
    root.setAttribute('data-radius', surfaceRadius);
    if (design.mode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('stroke_design', design.id);
      window.localStorage.setItem('stroke_radius', surfaceRadius);
      window.localStorage.setItem('stroke_font_size', String(editorFontSize));
      window.localStorage.setItem('stroke_layout', layoutMode);
    } catch {
      // ignore storage errors
    }
  }, [designId, surfaceRadius, editorFontSize, layoutMode]);

  // Workspace & editor state
  const [files, setFiles] = useState<WorkspaceFileNode[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [cloudFileCount, setCloudFileCount] = useState(0);

  // Terminal state
  const [terminalCwd, setTerminalCwd] = useState('.');
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpServerPublicView[]>([]);
  const [builtinInfo, setBuiltinInfo] = useState<{
    bearerTokenPreview: string;
    oauthClientId: string;
    hasValidSecret: boolean;
  } | null>(null);

  // Assistant state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantSending, setAssistantSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [liveTraces, setLiveTraces] = useState<ToolCallTrace[]>([]);

  const refreshFiles = useCallback(async () => {
    const fileNodes = await listFiles();
    setFiles(fileNodes);
    return fileNodes;
  }, []);

  const refreshMcp = useCallback(async () => {
    const res = await fetchMcpServers();
    setMcpServers(res.servers);
    setBuiltinInfo(res.builtinInfo);
    if (auth.currentUser) {
      void syncMcpBookmarksToFirestore(auth.currentUser.uid, res.servers).catch(() => undefined);
    }
  }, []);

  const openWorkspaceFile = useCallback(async (relPath: string) => {
    setFileLoading(true);
    try {
      const file = await readFile(relPath);
      setActiveFilePath(file.path);
      setEditorContent(file.content);
      setSavedContent(file.content);
    } finally {
      setFileLoading(false);
    }
  }, []);

  // Listen to Firebase Authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfileReadyUid(null);
        setActiveFilePath(null);
        setEditorContent('');
        setSavedContent('');
        setFiles([]);
        setTerminalEntries([]);
        setMessages([]);
        setMcpServers([]);
        setCloudFileCount(0);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      try {
        // 1. Ensure parent user profile exists in Firestore & restore preferences
        const syncedPrefs = await ensureUserProfileDoc(user, prefsRef.current);
        skipNextPrefSyncRef.current = true;
        setDesignId(syncedPrefs.designId);
        setSurfaceRadius(syncedPrefs.surfaceRadius);
        setEditorFontSize(syncedPrefs.editorFontSize);
        setLayoutMode(syncedPrefs.layoutMode);
        setThinkingLevel(syncedPrefs.thinkingLevel);
        setProfileReadyUid(user.uid);

        // 2. Restore any cloud-saved workspace files from Firestore
        const cloudFiles = await fetchUserCloudFiles(user.uid);
        setCloudFileCount(cloudFiles.length);

        const [fileNodes] = await Promise.all([
          cloudFiles.length > 0 ? hydrateWorkspace(cloudFiles) : refreshFiles(),
          refreshMcp(),
        ]);
        if (cloudFiles.length > 0) {
          setFiles(fileNodes);
        }

        const preferred =
          fileNodes.find((f) => f.type === 'file' && f.path === 'src/calculator.mjs') ||
          fileNodes.find((f) => f.type === 'file');
        if (preferred) {
          await openWorkspaceFile(preferred.path);
        }
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, [openWorkspaceFile, refreshFiles, refreshMcp]);

  // Subscribe to Firestore chat messages ONLY when authenticated and profile exists
  useEffect(() => {
    if (!firebaseUser || profileReadyUid !== firebaseUser.uid) {
      return undefined;
    }
    const unsubscribe = subscribeUserMessages(firebaseUser.uid, (cloudMsgs) => {
      setMessages(cloudMsgs);
    });
    return () => unsubscribe();
  }, [firebaseUser, profileReadyUid]);

  // Persist preference changes to Firestore
  useEffect(() => {
    if (!firebaseUser || profileReadyUid !== firebaseUser.uid) {
      return;
    }
    if (skipNextPrefSyncRef.current) {
      skipNextPrefSyncRef.current = false;
      return;
    }
    void updateUserPreferencesInFirestore(firebaseUser.uid, {
      designId,
      surfaceRadius,
      editorFontSize,
      layoutMode,
      thinkingLevel,
    }).catch(() => undefined);
  }, [
    firebaseUser,
    profileReadyUid,
    designId,
    surfaceRadius,
    editorFontSize,
    layoutMode,
    thinkingLevel,
  ]);

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleCreateFile = async (relPath: string) => {
    await saveFile(relPath, '');
    await refreshFiles();
    await openWorkspaceFile(relPath);
    setMobilePane('code');
    if (firebaseUser) {
      await syncWorkspaceFileToFirestore(firebaseUser.uid, relPath, '');
      setCloudFileCount((c) => c + 1);
    }
  };

  const handleDeleteFile = async (relPath: string) => {
    await deleteFile(relPath);
    if (firebaseUser) {
      void deleteWorkspaceFileFromFirestore(firebaseUser.uid, relPath).catch(() => undefined);
    }
    const updated = await refreshFiles();
    if (activeFilePath === relPath) {
      const next = updated.find((f) => f.type === 'file');
      if (next) {
        await openWorkspaceFile(next.path);
      } else {
        setActiveFilePath(null);
        setEditorContent('');
        setSavedContent('');
      }
    }
  };

  const handleSaveFile = async () => {
    if (!activeFilePath) return;
    setFileSaving(true);
    try {
      await saveFile(activeFilePath, editorContent);
      setSavedContent(editorContent);
      await refreshFiles();
      if (firebaseUser) {
        await syncWorkspaceFileToFirestore(firebaseUser.uid, activeFilePath, editorContent);
        const cloudFiles = await fetchUserCloudFiles(firebaseUser.uid);
        setCloudFileCount(cloudFiles.length);
      }
    } finally {
      setFileSaving(false);
    }
  };

  const handleExecuteTerminal = async (command: string) => {
    setTerminalRunning(true);
    setMobilePane('terminal');
    try {
      const result = await runTerminalCommand(command, terminalCwd);
      if (result.clear) {
        setTerminalEntries([]);
      } else {
        const entry: TerminalEntry = {
          id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          cwd: result.cwd,
          command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          source: 'user',
          timestamp: new Date().toISOString(),
        };
        setTerminalEntries((prev) => [...prev, entry]);
      }
      setTerminalCwd(result.nextCwd);
      await refreshFiles();
      if (activeFilePath) {
        await openWorkspaceFile(activeFilePath).catch(() => undefined);
      }
    } catch (err) {
      const entry: TerminalEntry = {
        id: `term_${Date.now()}`,
        cwd: terminalCwd,
        command,
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Terminal execution failed.',
        exitCode: 1,
        durationMs: 0,
        source: 'user',
        timestamp: new Date().toISOString(),
      };
      setTerminalEntries((prev) => [...prev, entry]);
    } finally {
      setTerminalRunning(false);
    }
  };

  const handleResetChat = async () => {
    setMessages([]);
    if (firebaseUser) {
      await clearUserChatHistory(firebaseUser.uid);
    }
  };

  const handleSendAssistantMessage = async (promptText: string) => {
    const uid = firebaseUser?.uid;
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: promptText,
      thinkingLevel,
      timestamp: new Date().toISOString(),
    };

    const historyForRequest = messages
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    if (uid) {
      void saveChatMessageToFirestore(uid, userMsg).catch(() => undefined);
    }

    setAssistantSending(true);
    setStatusMessage(`Connecting to gemini-4-hydrogen (${thinkingLevel})...`);
    setLiveTraces([]);

    let assistantReplyRecorded = false;

    try {
      await streamAssistantChat(
        {
          prompt: promptText,
          history: historyForRequest,
          activeFilePath: activeFilePath || undefined,
          thinkingLevel,
        },
        {
          onStatus: (msg) => setStatusMessage(msg),
          onToolStart: (trace) => {
            setLiveTraces((prev) => [...prev, trace]);
          },
          onToolResult: (updatedTrace) => {
            setLiveTraces((prev) =>
              prev.map((item) => (item.id === updatedTrace.id ? updatedTrace : item)),
            );
          },
          onTerminalEntry: (entry) => {
            setTerminalEntries((prev) => [...prev, entry]);
          },
          onWorkspaceUpdated: (updatedPath) => {
            void refreshFiles().then(async () => {
              if (updatedPath === activeFilePath) {
                await openWorkspaceFile(updatedPath);
              }
              if (uid && updatedPath && updatedPath !== '.') {
                try {
                  const fileData = await readFile(updatedPath);
                  await syncWorkspaceFileToFirestore(uid, fileData.path, fileData.content);
                } catch {
                  // ignore if deleted
                }
              }
            });
          },
          onAssistantMessage: ({ text, toolTraces }) => {
            assistantReplyRecorded = true;
            const assistantMsg: ChatMessage = {
              id: `msg_${Date.now()}_a`,
              role: 'assistant',
              content: text,
              thinkingLevel,
              toolTraces,
              timestamp: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            if (uid) {
              void saveChatMessageToFirestore(uid, assistantMsg).catch(() => undefined);
            }
          },
          onError: (errMsg) => {
            assistantReplyRecorded = true;
            const errorMsg: ChatMessage = {
              id: `msg_${Date.now()}_err`,
              role: 'assistant',
              content: '',
              thinkingLevel,
              error: errMsg,
              timestamp: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errorMsg]);
            if (uid) {
              void saveChatMessageToFirestore(uid, errorMsg).catch(() => undefined);
            }
          },
        },
      );

      if (!assistantReplyRecorded) {
        const emptyMsg: ChatMessage = {
          id: `msg_${Date.now()}_empty`,
          role: 'assistant',
          content: '',
          thinkingLevel,
          error: 'Assistant stream ended before returning a response.',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, emptyMsg]);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unable to reach Gemini 4 Hydrogen.';
      const failMsg: ChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: '',
        thinkingLevel,
        error: errMsg,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, failMsg]);
      if (uid) {
        void saveChatMessageToFirestore(uid, failMsg).catch(() => undefined);
      }
    } finally {
      setAssistantSending(false);
      setStatusMessage(null);
      setLiveTraces([]);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-muted)] flex items-center justify-center text-sm">
        Connecting to Firebase Authentication...
      </div>
    );
  }

  if (!firebaseUser) {
    return <AuthGate />;
  }

  const authStatus: AuthStatusResponse = {
    authenticated: true,
    uid: firebaseUser.uid,
    email: firebaseUser.email || undefined,
    displayName: firebaseUser.displayName || undefined,
    emailVerified: firebaseUser.emailVerified,
    providerId: firebaseUser.providerData?.[0]?.providerId || 'firebase',
  };

  const handleSelectMobilePane = (pane: MobilePane) => {
    setMobilePane(pane);
    if (pane === 'mcp') {
      setActiveView('mcp');
    } else {
      setActiveView('workbench');
    }
  };

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <TopBar
        activeView={activeView}
        onSelectView={(v) => {
          setActiveView(v);
          if (v === 'mcp') setMobilePane('mcp');
          if (v === 'workbench' && mobilePane === 'mcp') setMobilePane('code');
        }}
        onSignOut={() => void handleSignOut()}
      />

      {activeView === 'workbench' && (
        <>
          {/* Desktop Multi-Pane Workbench (md+) */}
          <div className="hidden md:flex flex-1 min-h-0">
            {layoutMode === 'standard' && (
              <FileExplorer
                files={files}
                activePath={activeFilePath}
                mcpServers={mcpServers}
                onSelectFile={(p) => void openWorkspaceFile(p)}
                onCreateFile={handleCreateFile}
                onDeleteFile={handleDeleteFile}
                onOpenMcpView={() => setActiveView('mcp')}
              />
            )}

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <CodeEditorPanel
                activePath={activeFilePath}
                content={editorContent}
                dirty={editorContent !== savedContent}
                saving={fileSaving}
                loading={fileLoading}
                fontSize={editorFontSize}
                onChangeContent={setEditorContent}
                onSave={handleSaveFile}
                onRunInTerminal={(cmd) => void handleExecuteTerminal(cmd)}
              />
              <TerminalPanel
                cwd={terminalCwd}
                entries={terminalEntries}
                running={terminalRunning}
                fontSize={editorFontSize}
                onExecute={handleExecuteTerminal}
                onClear={() => setTerminalEntries([])}
              />
            </div>

            <AssistantPanel
              messages={messages}
              mcpServers={mcpServers}
              thinkingLevel={thinkingLevel}
              statusMessage={statusMessage}
              liveTraces={liveTraces}
              sending={assistantSending}
              onChangeThinkingLevel={setThinkingLevel}
              onSendMessage={handleSendAssistantMessage}
              onResetChat={() => void handleResetChat()}
            />
          </div>

          {/* Mobile Single-Pane Workbench (< md) */}
          <div className="flex md:hidden flex-1 min-h-0 flex-col">
            {mobilePane === 'files' && (
              <FileExplorer
                files={files}
                activePath={activeFilePath}
                mcpServers={mcpServers}
                onSelectFile={(p) => {
                  void openWorkspaceFile(p);
                  setMobilePane('code');
                }}
                onCreateFile={handleCreateFile}
                onDeleteFile={handleDeleteFile}
                onOpenMcpView={() => {
                  setActiveView('mcp');
                  setMobilePane('mcp');
                }}
              />
            )}
            {mobilePane === 'code' && (
              <CodeEditorPanel
                activePath={activeFilePath}
                content={editorContent}
                dirty={editorContent !== savedContent}
                saving={fileSaving}
                loading={fileLoading}
                fontSize={editorFontSize}
                onChangeContent={setEditorContent}
                onSave={handleSaveFile}
                onRunInTerminal={(cmd) => void handleExecuteTerminal(cmd)}
              />
            )}
            {mobilePane === 'terminal' && (
              <TerminalPanel
                cwd={terminalCwd}
                entries={terminalEntries}
                running={terminalRunning}
                fontSize={editorFontSize}
                fullHeight
                onExecute={handleExecuteTerminal}
                onClear={() => setTerminalEntries([])}
              />
            )}
            {mobilePane === 'assistant' && (
              <AssistantPanel
                messages={messages}
                mcpServers={mcpServers}
                thinkingLevel={thinkingLevel}
                statusMessage={statusMessage}
                liveTraces={liveTraces}
                sending={assistantSending}
                onChangeThinkingLevel={setThinkingLevel}
                onSendMessage={handleSendAssistantMessage}
                onResetChat={() => void handleResetChat()}
              />
            )}
          </div>
        </>
      )}

      {activeView === 'mcp' && (
        <McpServersView
          servers={mcpServers}
          builtinInfo={builtinInfo}
          onServersUpdated={(updated) => {
            setMcpServers(updated);
            if (firebaseUser) {
              void syncMcpBookmarksToFirestore(firebaseUser.uid, updated).catch(() => undefined);
            }
          }}
          onRefreshServers={refreshMcp}
        />
      )}

      {activeView === 'designs' && (
        <DesignsView
          designId={designId}
          radius={surfaceRadius}
          fontSize={editorFontSize}
          layoutMode={layoutMode}
          onChangeDesign={setDesignId}
          onChangeRadius={setSurfaceRadius}
          onChangeFontSize={setEditorFontSize}
          onChangeLayoutMode={setLayoutMode}
          onOpenSecurity={() => setActiveView('security')}
          onBackToWorkbench={() => {
            setActiveView('workbench');
            setMobilePane('code');
          }}
        />
      )}

      {activeView === 'security' && (
        <SecurityAuthView
          authStatus={authStatus}
          servers={mcpServers}
          cloudFileCount={cloudFileCount}
          cloudMessageCount={messages.length}
        />
      )}

      <MobileBottomNav
        activePane={activeView === 'mcp' ? 'mcp' : mobilePane}
        onSelectPane={handleSelectMobilePane}
      />
    </div>
  );
}
