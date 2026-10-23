'use client';

import type { SourceFile } from './uploader';

/**
 * Browser glue: turns a folder drop or a file picker selection into SourceFiles (doc 02 §7 "Folder
 * drop: drag a whole card folder"). Directory walking uses the File and Directory Entries API.
 */

export function toSourceFile(file: File, path?: string): SourceFile {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    path: path ?? (file.webkitRelativePath || file.name),
    read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
  };
}

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const entryFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: FileSystemEntry, prefix: string, out: SourceFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    out.push(toSourceFile(await entryFile(entry as FileSystemFileEntry), path));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries per call: keep reading until it returns none.
    for (;;) {
      const batch = await readEntries(reader);
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path, out);
    }
  }
}

/** Every file in a drop, folders walked recursively. */
export async function filesFromDrop(data: DataTransfer): Promise<SourceFile[]> {
  const entries = [...data.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...data.files].map((f) => toSourceFile(f));
  const out: SourceFile[] = [];
  for (const entry of entries) await walk(entry, '', out);
  return out;
}

export const filesFromInput = (list: FileList | null): SourceFile[] =>
  list ? [...list].map((f) => toSourceFile(f)) : [];
