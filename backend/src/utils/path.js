import path from 'path';
import fs from 'fs-extra';

export function normalizePath(p) {
  if (!p || p === '/') return '/';
  p = p.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function joinPath(...parts) {
  return normalizePath(path.join(...parts));
}

export function getParentPath(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized === '/') return null;
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/');
}

export function getFileName(filePath) {
  return path.basename(filePath);
}

export function ensureStorageDir(storagePath) {
  fs.ensureDirSync(storagePath);
  fs.ensureDirSync(path.join(storagePath, 'chunks'));
  fs.ensureDirSync(path.join(storagePath, 'files'));
}
