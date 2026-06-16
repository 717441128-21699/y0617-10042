import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { logOperation } from '../middleware/logger.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { fileId, expireHours = 24, password } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    const getFileStmt = db.prepare(`
      SELECT * FROM files WHERE id = ? AND type = 'file' AND deleted = 0
    `);
    const file = await getFileStmt.get(fileId);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const token = uuidv4().replace(/-/g, '').slice(0, 16);
    const expiresAt = new Date(Date.now() + expireHours * 60 * 60 * 1000).toISOString();
    
    const existingShare = await db.prepare(`
      SELECT id FROM shares 
      WHERE file_id = ? AND revoked = 0 AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `).get(fileId);
    
    if (existingShare) {
      await db.prepare(`
        UPDATE shares 
        SET expires_at = ?, password = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(expiresAt, password || null, existingShare.id);
      
      logOperation('update_share', fileId, file.name, {
        token,
        expireHours,
        hasPassword: !!password
      }, req);
      
      const getShareStmt = db.prepare(`
        SELECT s.*, f.name, f.size, f.type, f.path, f.storage_path
        FROM shares s
        JOIN files f ON s.file_id = f.id
        WHERE s.id = ?
      `);
      const share = await getShareStmt.get(existingShare.id);
      return res.json(share);
    }
    
    const stmt = db.prepare(`
      INSERT INTO shares (file_id, token, password, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    
    const info = await stmt.run(fileId, token, password || null, expiresAt);
    
    logOperation('create_share', fileId, file.name, {
      token,
      expireHours,
      hasPassword: !!password
    }, req);
    
    const getShareStmt = db.prepare(`
      SELECT s.*, f.name, f.size, f.type, f.path, f.storage_path
      FROM shares s
      JOIN files f ON s.file_id = f.id
      WHERE s.id = ?
    `);
    const share = await getShareStmt.get(info.lastInsertRowid);
    
    res.json(share);
  } catch (error) {
    console.error('Create share error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const stmt = db.prepare(`
      SELECT s.*, f.name, f.size, f.type, f.path, f.storage_path, f.md5
      FROM shares s
      JOIN files f ON s.file_id = f.id
      WHERE s.token = ? AND s.revoked = 0
    `);
    const share = await stmt.get(token);
    
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    if (new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share has expired' });
    }
    
    await db.prepare(`
      UPDATE shares SET view_count = view_count + 1 WHERE id = ?
    `).run(share.id);
    
    res.json({
      id: share.id,
      token: share.token,
      file: {
        id: share.file_id,
        name: share.name,
        size: share.size,
        type: share.type,
        md5: share.md5
      },
      hasPassword: !!share.password,
      expiresAt: share.expires_at,
      viewCount: share.view_count,
      downloadCount: share.download_count
    });
  } catch (error) {
    console.error('Get share error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/token/:token/verify', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    const stmt = db.prepare(`
      SELECT s.*, f.name, f.size, f.type, f.path, f.storage_path
      FROM shares s
      JOIN files f ON s.file_id = f.id
      WHERE s.token = ? AND s.revoked = 0
    `);
    const share = await stmt.get(token);
    
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    if (new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share has expired' });
    }
    
    if (share.password && share.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    res.json({
      success: true,
      file: {
        id: share.file_id,
        name: share.name,
        size: share.size,
        type: share.type,
        storagePath: share.storage_path
      }
    });
  } catch (error) {
    console.error('Verify share error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { fileId } = req.query;
    
    let shares;
    if (fileId) {
      const stmt = db.prepare(`
        SELECT s.*, f.name, f.size, f.type, f.path
        FROM shares s
        JOIN files f ON s.file_id = f.id
        WHERE s.file_id = ? AND s.revoked = 0
        ORDER BY s.created_at DESC
      `);
      shares = await stmt.all(fileId);
    } else {
      const stmt = db.prepare(`
        SELECT s.*, f.name, f.size, f.type, f.path
        FROM shares s
        JOIN files f ON s.file_id = f.id
        WHERE s.revoked = 0
        ORDER BY s.created_at DESC
        LIMIT 100
      `);
      shares = await stmt.all();
    }
    
    const validShares = shares.map(s => ({
      ...s,
      isExpired: new Date(s.expires_at) < new Date()
    }));
    
    res.json(validShares);
  } catch (error) {
    console.error('List shares error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const getStmt = db.prepare(`
      SELECT s.*, f.name 
      FROM shares s
      JOIN files f ON s.file_id = f.id
      WHERE s.id = ?
    `);
    const share = await getStmt.get(id);
    
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    const stmt = db.prepare(`
      UPDATE shares SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    await stmt.run(id);
    
    logOperation('revoke_share', share.file_id, share.name, {
      token: share.token
    }, req);
    
    res.json({ success: true, message: 'Share revoked successfully' });
  } catch (error) {
    console.error('Revoke share error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
