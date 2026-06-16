export function normalizePath(p) {
  if (!p || p === '/') return '/';
  p = p.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function joinPath(...parts) {
  let result = parts
    .map(p => (p || '').replace(/\\/g, '/'))
    .filter(p => p && p !== '/')
    .join('/');
  
  return normalizePath('/' + result);
}

export function getParentPath(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized === '/') return null;
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/');
}

export function formatFileSize(bytes) {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function getFileIconClass(filename, type) {
  if (type === 'folder') return 'folder-icon';
  
  const ext = filename.split('.').pop().toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'avi'];
  const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
  
  if (imageExts.includes(ext)) return 'image-icon';
  if (videoExts.includes(ext)) return 'video-icon';
  if (audioExts.includes(ext)) return 'audio-icon';
  if (ext === 'pdf') return 'pdf-icon';
  
  return 'file-icon-default';
}
