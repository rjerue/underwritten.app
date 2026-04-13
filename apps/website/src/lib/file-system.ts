export type FileStorageMode = "origin-private" | "native-folder";

export type BrowserTreeEntry = {
  kind: "directory" | "file";
  name: string;
  path: string;
  updatedAt: number | null;
};

export type WorkspaceFileSnapshot = {
  content: string;
  path: string;
};

const handleDatabaseName = "underwritten-file-handles";
const handleStoreName = "handles";
const nativeDirectoryHandleKey = "native-directory";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
};

type StorageManagerWithDirectory = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

type PermissionedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

type FileSystemEntryHandle =
  | { handle: FileSystemDirectoryHandle; kind: "directory" }
  | { handle: FileSystemFileHandle; kind: "file" };

function normalizePath(path: string) {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function splitPath(path: string) {
  const normalizedPath = normalizePath(path);
  return normalizedPath.length > 0 ? normalizedPath.split("/") : [];
}

function dirname(path: string) {
  const parts = splitPath(path);
  return parts.slice(0, -1).join("/");
}

function basename(path: string) {
  const parts = splitPath(path);
  return parts.at(-1) ?? "";
}

function joinPath(parentPath: string, name: string) {
  return [normalizePath(parentPath), name].filter(Boolean).join("/");
}

function sortEntries(entries: BrowserTreeEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

async function getEntryHandleAtPath(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  path: string,
): Promise<FileSystemEntryHandle> {
  const normalizedPath = normalizePath(path);
  if (normalizedPath.length === 0) {
    return {
      handle: await getActiveDirectoryHandle(mode, nativeDirectoryHandle),
      kind: "directory",
    };
  }

  const parentDirectoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    dirname(normalizedPath),
  );
  const entryName = basename(normalizedPath);

  try {
    const fileHandle = await parentDirectoryHandle.getFileHandle(entryName);
    return { handle: fileHandle, kind: "file" };
  } catch {}

  try {
    const directoryHandle = await parentDirectoryHandle.getDirectoryHandle(entryName);
    return { handle: directoryHandle, kind: "directory" };
  } catch {}

  throw new Error(`Path does not exist: ${normalizedPath}`);
}

async function ensureDestinationAvailable(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  path: string,
) {
  try {
    await getEntryHandleAtPath(mode, nativeDirectoryHandle, path);
    throw new Error(`A file or folder already exists at ${path}.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A file or folder already exists")) {
      throw error;
    }
  }
}

async function copyFileHandle(
  sourceHandle: FileSystemFileHandle,
  destinationDirectoryHandle: FileSystemDirectoryHandle,
  destinationName: string,
) {
  const sourceFile = await sourceHandle.getFile();
  const destinationHandle = await destinationDirectoryHandle.getFileHandle(destinationName, {
    create: true,
  });
  const writable = await destinationHandle.createWritable();
  await writable.write(await sourceFile.arrayBuffer());
  await writable.close();
}

async function copyDirectoryHandle(
  sourceHandle: FileSystemDirectoryHandle,
  destinationDirectoryHandle: FileSystemDirectoryHandle,
  destinationName: string,
) {
  const nextDirectoryHandle = await destinationDirectoryHandle.getDirectoryHandle(destinationName, {
    create: true,
  });
  const iterableSourceHandle = sourceHandle as IterableDirectoryHandle;

  for await (const [entryName, entryHandle] of iterableSourceHandle.entries()) {
    if (entryHandle.kind === "directory") {
      await copyDirectoryHandle(
        entryHandle as FileSystemDirectoryHandle,
        nextDirectoryHandle,
        entryName,
      );
      continue;
    }

    await copyFileHandle(entryHandle as FileSystemFileHandle, nextDirectoryHandle, entryName);
  }
}

async function collectWorkspaceSnapshots(
  directoryHandle: FileSystemDirectoryHandle,
  directoryPath = "",
): Promise<WorkspaceFileSnapshot[]> {
  const iterableDirectoryHandle = directoryHandle as IterableDirectoryHandle;
  const snapshots: WorkspaceFileSnapshot[] = [];

  for await (const [name, handle] of iterableDirectoryHandle.entries()) {
    const entryPath = joinPath(directoryPath, name);

    if (handle.kind === "directory") {
      snapshots.push(
        ...(await collectWorkspaceSnapshots(handle as FileSystemDirectoryHandle, entryPath)),
      );
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    snapshots.push({
      content: decodeTextFileContent(await file.arrayBuffer(), entryPath),
      path: entryPath,
    });
  }

  return snapshots.sort((left, right) => left.path.localeCompare(right.path));
}

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(handleDatabaseName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(handleStoreName)) {
        database.createObjectStore(handleStoreName);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open handle database."));
    };
  });
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const database = await openHandleDatabase();

  try {
    const transaction = database.transaction(handleStoreName, mode);
    const store = transaction.objectStore(handleStoreName);
    const result = await callback(store);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Handle transaction aborted."));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Handle transaction failed."));
    });

    return result;
  } finally {
    database.close();
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function getOriginPrivateDirectoryHandle() {
  const storageManager = navigator.storage as StorageManagerWithDirectory;

  if (typeof storageManager.getDirectory !== "function") {
    throw new Error("Origin private file system is not available in this browser.");
  }

  return await storageManager.getDirectory();
}

async function verifyDirectoryPermission(handle: FileSystemDirectoryHandle) {
  const permissionedHandle = handle as PermissionedDirectoryHandle;

  if (
    typeof permissionedHandle.queryPermission === "function" &&
    (await permissionedHandle.queryPermission({ mode: "readwrite" })) === "granted"
  ) {
    return true;
  }

  if (typeof permissionedHandle.requestPermission === "function") {
    return (await permissionedHandle.requestPermission({ mode: "readwrite" })) === "granted";
  }

  return true;
}

async function getActiveDirectoryHandle(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
) {
  if (mode === "origin-private") {
    return await getOriginPrivateDirectoryHandle();
  }

  if (!nativeDirectoryHandle) {
    throw new Error("Choose a native folder before browsing local files.");
  }

  const granted = await verifyDirectoryPermission(nativeDirectoryHandle);
  if (!granted) {
    throw new Error("File access to the chosen folder was not granted.");
  }

  return nativeDirectoryHandle;
}

async function getDirectoryHandleAtPath(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  directoryPath = "",
  options?: { create?: boolean },
) {
  let currentDirectoryHandle = await getActiveDirectoryHandle(mode, nativeDirectoryHandle);

  for (const segment of splitPath(directoryPath)) {
    currentDirectoryHandle = await currentDirectoryHandle.getDirectoryHandle(segment, {
      create: options?.create ?? false,
    });
  }

  return currentDirectoryHandle;
}

export function supportsNativeDirectoryAccess() {
  return typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function";
}

export async function pickNativeDirectory() {
  const pickerWindow = window as WindowWithDirectoryPicker;

  if (typeof pickerWindow.showDirectoryPicker !== "function") {
    throw new Error("Native folder access is not available in this browser.");
  }

  return await pickerWindow.showDirectoryPicker({ mode: "readwrite" });
}

export async function loadStoredNativeDirectoryHandle() {
  try {
    return await withHandleStore("readonly", async (store) => {
      const result = await requestToPromise(store.get(nativeDirectoryHandleKey));
      return result instanceof FileSystemDirectoryHandle ? result : null;
    });
  } catch {
    return null;
  }
}

export async function saveNativeDirectoryHandle(handle: FileSystemDirectoryHandle) {
  await withHandleStore("readwrite", async (store) => {
    await requestToPromise(store.put(handle, nativeDirectoryHandleKey));
  });
}

export async function listDirectory(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  directoryPath = "",
) {
  const directoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    directoryPath,
  );
  const iterableDirectoryHandle = directoryHandle as IterableDirectoryHandle;
  const entries: BrowserTreeEntry[] = [];

  for await (const [name, handle] of iterableDirectoryHandle.entries()) {
    if (handle.kind === "directory") {
      entries.push({
        kind: "directory",
        name,
        path: joinPath(directoryPath, name),
        updatedAt: null,
      });
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    entries.push({
      kind: "file",
      name,
      path: joinPath(directoryPath, name),
      updatedAt: file.lastModified,
    });
  }

  return sortEntries(entries);
}

function isUnsupportedTextControlCharacter(value: number) {
  return (
    (value < 32 && value !== 9 && value !== 10 && value !== 13) || (value >= 127 && value <= 159)
  );
}

function createBinaryFileError(filePath?: string) {
  return new Error(
    filePath
      ? `Cannot open ${filePath} because it appears to be a binary file.`
      : "Cannot open this file because it appears to be a binary file.",
  );
}

export function decodeTextFileContent(content: ArrayBuffer | Uint8Array, filePath?: string) {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);

  if (bytes.includes(0)) {
    throw createBinaryFileError(filePath);
  }

  let decodedContent: string;
  try {
    decodedContent = textDecoder.decode(bytes);
  } catch {
    throw createBinaryFileError(filePath);
  }

  for (let index = 0; index < decodedContent.length; index += 1) {
    if (isUnsupportedTextControlCharacter(decodedContent.charCodeAt(index))) {
      throw createBinaryFileError(filePath);
    }
  }

  return decodedContent;
}

export async function createDirectory(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  directoryPath: string,
) {
  const normalizedPath = normalizePath(directoryPath);
  if (normalizedPath.length === 0) {
    throw new Error("Folder name cannot be empty.");
  }

  const parentDirectoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    dirname(normalizedPath),
    { create: true },
  );

  await parentDirectoryHandle.getDirectoryHandle(basename(normalizedPath), { create: true });
}

export async function readFile(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  filePath: string,
) {
  const normalizedPath = normalizePath(filePath);
  const directoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    dirname(normalizedPath),
  );
  const fileHandle = await directoryHandle.getFileHandle(basename(normalizedPath));
  const file = await fileHandle.getFile();

  return decodeTextFileContent(await file.arrayBuffer(), normalizedPath);
}

export async function writeFile(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  filePath: string,
  content: string,
) {
  const normalizedPath = normalizePath(filePath);
  if (normalizedPath.length === 0) {
    throw new Error("File name cannot be empty.");
  }

  const directoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    dirname(normalizedPath),
    { create: true },
  );
  const fileHandle = await directoryHandle.getFileHandle(basename(normalizedPath), {
    create: true,
  });
  const writable = await fileHandle.createWritable();

  await writable.write(content);
  await writable.close();

  const file = await fileHandle.getFile();

  return {
    kind: "file",
    name: file.name,
    path: normalizedPath,
    updatedAt: file.lastModified,
  } satisfies BrowserTreeEntry;
}

export async function deletePath(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  path: string,
) {
  const normalizedPath = normalizePath(path);
  if (normalizedPath.length === 0) {
    throw new Error("Cannot delete the root directory.");
  }

  const parentDirectoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    dirname(normalizedPath),
  );
  const entry = await getEntryHandleAtPath(mode, nativeDirectoryHandle, normalizedPath);

  await parentDirectoryHandle.removeEntry(basename(normalizedPath), {
    recursive: entry.kind === "directory",
  });
}

export async function movePath(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  sourcePath: string,
  destinationPath: string,
) {
  const normalizedSourcePath = normalizePath(sourcePath);
  const normalizedDestinationPath = normalizePath(destinationPath);

  if (normalizedSourcePath.length === 0 || normalizedDestinationPath.length === 0) {
    throw new Error("Source and destination paths are required.");
  }

  if (
    normalizedDestinationPath === normalizedSourcePath ||
    normalizedDestinationPath.startsWith(`${normalizedSourcePath}/`)
  ) {
    throw new Error("Cannot move a folder into itself.");
  }

  await ensureDestinationAvailable(mode, nativeDirectoryHandle, normalizedDestinationPath);

  const sourceEntry = await getEntryHandleAtPath(mode, nativeDirectoryHandle, normalizedSourcePath);
  const destinationDirectoryHandle = await getDirectoryHandleAtPath(
    mode,
    nativeDirectoryHandle,
    dirname(normalizedDestinationPath),
    { create: true },
  );
  const destinationName = basename(normalizedDestinationPath);

  if (sourceEntry.kind === "directory") {
    await copyDirectoryHandle(sourceEntry.handle, destinationDirectoryHandle, destinationName);
  } else {
    await copyFileHandle(sourceEntry.handle, destinationDirectoryHandle, destinationName);
  }

  await deletePath(mode, nativeDirectoryHandle, normalizedSourcePath);
}

export async function snapshotWorkspace(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
) {
  const directoryHandle = await getActiveDirectoryHandle(mode, nativeDirectoryHandle);
  return await collectWorkspaceSnapshots(directoryHandle);
}
