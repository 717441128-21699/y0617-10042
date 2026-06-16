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

async function getFileOrShare(id, token) {
  if (token) {
    const shareStmt = db.prepare(`
      SELECT * FROM shares
      WHERE token = ? AND revoked = 0
    `);
    const share = await shareStmt.get(token);
    
    if (!share) return { error: 'Share not found', status: 404 };
    if (new Date(share.expires_at) < new Date()) return { error: 'Share has expired', status: 410 };
    
    const fileStmt = db.prepare(`
      SELECT * FROM files WHERE id = ? AND deleted = 0
    `);
    const file = await fileStmt.get(share.file_id);
    if (!file) return { error: 'File not found', status: 404 };
    
    return {
      file,
      isShare: true,
      shareId: share.id,
      token
    };
  }
  
  const fileStmt = db.prepare(`
    SELECT * FROM files WHERE id = ? AND deleted = 0
  `);
  const file = await fileStmt.get(id);
  
  if (!file) return { error: 'File not found', status: 404 };
  if (file.type === 'folder') return { error: 'Folders cannot be previewed', status: 400 };
  
  return { file, isShare: false };
}

router.get('/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;
    
    const result = await getFileOrShare(id, token);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    
    const { file } = result;
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

router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const { download, token } = req.query;
    
    const result = await getFileOrShare(id, token);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    
    const { file, isShare, shareId } = result;
    const shareToken = result.token;
    const filePath = file.storage_path;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const fileName = file.name;
    const fileSize = fs.statSync(filePath).size;
    const contentType = mime.contentType(fileName) || 'application/octet-stream';
    const previewType = getPreviewType(fileName);
    
    if (isShare) {
      await db.prepare(`
        UPDATE shares SET download_count = download_count + 1 WHERE id = ?
      `).run(shareId);
      
      await logOperation(download === '1' ? 'share_download' : 'share_view', file.id, fileName, {
        token: shareToken,
        shareId
      }, req);
    } else if (download === '1') {
      await logOperation('download', file.id, fileName, {
        size: file.size,
        path: file.path
      }, req);
    } else {
      await logOperation('preview', file.id, fileName, {
        size: file.size,
        path: file.path
      }, req);
    }
    
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
      if (previewType === 'video' || previewType === 'audio') {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      return fs.createReadStream(filePath).pipe(res);
    }
    
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
    
  } catch (error) {
    console.error('Preview content error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;
    
    const result = await getFileOrShare(id, token);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    
    const { file, isShare, shareId } = result;
    const shareToken = result.token;
    const filePath = file.storage_path;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const fileName = file.name;
    const fileSize = fs.statSync(filePath).size;
    const contentType = mime.contentType(fileName) || 'application/octet-stream';
    
    if (isShare) {
      await db.prepare(`
        UPDATE shares SET download_count = download_count + 1 WHERE id = ?
      `).run(shareId);
      
      await logOperation('share_download', file.id, fileName, {
        token: shareToken,
        shareId
      }, req);
    } else {
      await logOperation('download', file.id, fileName, {
        size: file.size,
        path: file.path
      }, req);
    }
    
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;
    
    const result = await getFileOrShare(id, token);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    
    const { file } = result;
    const filePath = file.storage_path;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const previewType = getPreviewType(file.name);
    if (previewType !== 'image') {
      return res.status(400).json({ error: 'Thumbnails only available for images' });
    }
    
    const fileName = file.name;
    const fileSize = fs.statSync(filePath).size;
    const contentType = mime.contentType(fileName) || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
    
  } catch (error) {
    console.error('Thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.query;
    
    const result = await getFileOrShare(id, token);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    
    const { file } = result;
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
