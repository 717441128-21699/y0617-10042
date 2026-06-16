import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import mime from 'mime-types';
import rangeParser from 'range-parser';
import db from '../db.js';
import { logOperation } from '../middleware/logger.js';

const router = express.Router();

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.avi'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac'];
const PDF_EXTENSIONS = ['.pdf'];

function getPreviewType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (PDF_EXTENSIONS.includes(ext)) return 'pdf';
  return 'unknown';
}

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { download, token } = req.query;
    
    let file;
    
    if (token) {
      const shareStmt = db.prepare(`
        SELECT s.*, f.name, f.size, f.type, f.storage_path, f.path
        FROM shares s
        JOIN files f ON s.file_id = f.id
        WHERE s.token = ? AND s.revoked = 0
      `);
      const share = await shareStmt.get(token);
      
      if (!share) {
        return res.status(404).json({ error: 'Share not found' });
      }
      
      if (new Date(share.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Share has expired' });
      }
      
      file = share;
      
      await db.prepare(`
        UPDATE shares SET download_count = download_count + 1 WHERE id = ?
      `).run(share.id);
      
      logOperation('share_download', share.file_id, share.name, {
        token,
        shareId: share.id
      }, req);
    } else {
      const fileStmt = db.prepare(`
        SELECT * FROM files WHERE id = ? AND deleted = 0
      `);
      file = await fileStmt.get(id);
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      if (file.type === 'folder') {
        return res.status(400).json({ error: 'Folders cannot be previewed' });
      }
      
      logOperation('download', id, file.name, {
        size: file.size,
        path: file.path
      }, req);
    }
    
    const filePath = file.storage_path;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const fileName = file.name;
    const fileSize = fs.statSync(filePath).size;
    const contentType = mime.contentType(fileName) || 'application/octet-stream';
    const previewType = getPreviewType(fileName);
    
    if (download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      return fs.createReadStream(filePath).pipe(res);
    }
    
    if (previewType === 'video' && req.headers.range) {
      const range = rangeParser(fileSize, req.headers.range);
      
      if (range === -1 || range === -2 || range.length === 0) {
        res.status(416).header('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      
      const { start, end } = range[0];
      const chunkSize = (end - start) + 1;
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    
    if (previewType === 'image' || previewType === 'pdf' || previewType === 'audio' || previewType === 'video') {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return fs.createReadStream(filePath).pipe(res);
    }
    
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
    
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;
    
    let file;
    
    if (token) {
      const shareStmt = db.prepare(`
        SELECT s.*, f.name, f.size, f.type, f.storage_path, f.path, f.md5
        FROM shares s
        JOIN files f ON s.file_id = f.id
        WHERE s.token = ? AND s.revoked = 0
      `);
      const share = await shareStmt.get(token);
      
      if (!share) {
        return res.status(404).json({ error: 'Share not found' });
      }
      
      if (new Date(share.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Share has expired' });
      }
      
      file = share;
    } else {
      const fileStmt = db.prepare(`
        SELECT * FROM files WHERE id = ? AND deleted = 0
      `);
      file = await fileStmt.get(id);
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }
    }
    
    const filePath = file.storage_path;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const previewType = getPreviewType(file.name);
    const contentType = mime.contentType(file.name) || 'application/octet-stream';
    const fileSize = fs.statSync(filePath).size;
    
    res.json({
      id: file.id,
      name: file.name,
      size: fileSize,
      contentType,
      previewType,
      canPreview: previewType !== 'unknown',
      md5: file.md5
    });
  } catch (error) {
    console.error('Preview info error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
