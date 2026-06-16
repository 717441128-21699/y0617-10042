import express from 'express';
import fs from 'fs-extra';
import mime from 'mime-types';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { logOperation } from '../middleware/logger.js';

const router = express.Router();

async function getFileById(id) {
  const stmt = db.prepare(`
    SELECT * FROM files WHERE id = ? AND deleted = 0
  `);
  return await stmt.get(id);
}

function formatShareWithFile(share, file) {
  if (!share) return null;
  return {
    id: share.id,
    share_token: share.token,
    expire_at: share.expires_at,
    revoked: share.revoked,
    views: share.view_count || 0,
    downloads: share.download_count || 0,
    created_at: share.created_at,
    updated_at: share.updated_at,
    fileId: file ? file.id : share.file_id,
    name: file ? file.name : null,
    size: file ? file.size : 0,
    type: file ? file.type : null,
    path: file ? file.path : null,
    storage_path: file ? file.storage_path : null,
    md5: file ? file.md5 : null
  };
}

router.post('/create', async (req, res) => {
  try {
    const { fileId, expireHours = 24, password } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    const file = await getFileById(fileId);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const token = uuidv4().replace(/-/g, '').slice(0, 16);
    const expiresAt = expireHours === 0 
      ? new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + expireHours * 60 * 60 * 1000).toISOString();
    
    const existingShare = await db.prepare(`
      SELECT * FROM shares 
      WHERE file_id = ? AND revoked = 0
      LIMIT 1
    `).get(fileId);
    
    if (existingShare) {
      await db.prepare(`
        UPDATE shares 
        SET expires_at = ?, password = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(expiresAt, password || null, existingShare.id);
      
      await logOperation('update_share', fileId, file.name, {
        token,
        expireHours,
        hasPassword: !!password
      }, req);
      
      const updatedShare = await db.prepare('SELECT * FROM shares WHERE id = ?').get(existingShare.id);
      const share = formatShareWithFile(updatedShare, file);
      return res.json(share);
    }
    
    const stmt = db.prepare(`
      INSERT INTO shares (file_id, token, password, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    
    const info = await stmt.run(fileId, token, password || null, expiresAt);
    
    await logOperation('create_share', fileId, file.name, {
      token,
      expireHours,
      hasPassword: !!password
    }, req);
    
    const newShare = await db.prepare('SELECT * FROM shares WHERE id = ?').get(info.lastInsertRowid);
    const share = formatShareWithFile(newShare, file);
    
    res.json(share);
  } catch (error) {
    console.error('Create share error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await getFileById(fileId);
    
    const stmt = db.prepare(`
      SELECT * FROM shares
      WHERE file_id = ? AND revoked = 0
      ORDER BY created_at DESC
    `);
    const shares = await stmt.all(fileId);
    
    const validShares = shares.map(s => {
      const formatted = formatShareWithFile(s, file);
      formatted.isExpired = new Date(formatted.expire_at) < new Date();
      return formatted;
    });
    
    res.json(validShares);
  } catch (error) {
    console.error('Get file shares error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const shareStmt = db.prepare(`
      SELECT * FROM shares
      WHERE token = ? AND revoked = 0
    `);
    const share = await shareStmt.get(token);
    
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    if (new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share has expired' });
    }
    
    const file = await getFileById(share.file_id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    await db.prepare(`
      UPDATE shares SET view_count = view_count + 1 WHERE token = ?
    `).run(token);
    
    await logOperation('share_view', file.id, file.name, {
      token,
      shareId: share.id
    }, req);
    
    res.json({
      id: share.id,
      share_token: share.token,
      fileId: file.id,
      name: file.name,
      size: file.size,
      type: file.type,
      md5: file.md5,
      hasPassword: !!share.password,
      expire_at: share.expires_at,
      createdAt: share.created_at,
      views: (share.view_count || 0) + 1,
      downloads: share.download_count || 0
    });
  } catch (error) {
    console.error('Get share error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:token/download', async (req, res) => {
  try {
    const { token } = req.params;
    
    const shareStmt = db.prepare(`
      SELECT * FROM shares
      WHERE token = ? AND revoked = 0
    `);
    const share = await shareStmt.get(token);
    
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    if (new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share has expired' });
    }
    
    const file = await getFileById(share.file_id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    await db.prepare(`
      UPDATE shares SET download_count = download_count + 1 WHERE token = ?
    `).run(token);
    
    await logOperation('share_download', file.id, file.name, {
      token,
      shareId: share.id
    }, req);
    
    const filePath = file.storage_path;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const fileName = file.name;
    const fileSize = fs.statSync(filePath).size;
    const contentType = mime.contentType(fileName) || 'application/octet-stream';
    
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
    
  } catch (error) {
    console.error('Share download error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const getStmt = db.prepare(`
      SELECT * FROM shares
      WHERE token = ?
    `);
    const share = await getStmt.get(token);
    
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    const file = await getFileById(share.file_id);
    const fileName = file ? file.name : 'unknown';
    
    const stmt = db.prepare(`
      UPDATE shares SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE token = ?
    `);
    await stmt.run(token);
    
    await logOperation('revoke_share', share.file_id, fileName, {
      token
    }, req);
    
    res.json({ success: true, message: 'Share revoked successfully' });
  } catch (error) {
    console.error('Revoke share error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
