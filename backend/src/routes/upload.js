import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import db from '../db.js';
import { logOperation } from '../middleware/logger.js';
import { normalizePath, joinPath } from '../utils/path.js';

const router = express.Router();
const CHUNK_SIZE = parseInt(process.env.MAX_CHUNK_SIZE) || 5 * 1024 * 1024;

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: CHUNK_SIZE * 2 } });

const getStoragePath = () => path.resolve(process.env.STORAGE_PATH || './storage');
const getChunksPath = () => path.join(getStoragePath(), 'chunks');
const getFilesPath = () => path.join(getStoragePath(), 'files');

async function getFileIdByPath(filePath, fileName) {
  const stmt = db.prepare(`
    SELECT id FROM files 
    WHERE path = ? AND name = ? AND type = 'file' AND deleted = 0
  `);
  return await stmt.get(filePath, fileName);
}

async function getParentId(filePath) {
  if (filePath === '/' || !filePath) return null;
  
  const parts = filePath.split('/').filter(Boolean);
  let currentPath = '/';
  let parentId = null;
  
  for (const part of parts) {
    const stmt = db.prepare(`
      SELECT id FROM files 
      WHERE path = ? AND name = ? AND type = 'folder' AND deleted = 0
    `);
    const result = await stmt.get(currentPath, part);
    if (!result) return null;
    parentId = result.id;
    currentPath = joinPath(currentPath, part);
  }
  
  return parentId;
}

async function ensureFoldersExist(filePath) {
  if (filePath === '/' || !filePath) return;
  
  const parts = filePath.split('/').filter(Boolean);
  let currentPath = '/';
  let parentId = null;
  
  for (const part of parts) {
    const checkStmt = db.prepare(`
      SELECT id FROM files 
      WHERE path = ? AND name = ? AND type = 'folder' AND deleted = 0
    `);
    let result = await checkStmt.get(currentPath, part);
    
    if (!result) {
      const insertStmt = db.prepare(`
        INSERT INTO files (name, path, type, parent_id)
        VALUES (?, ?, 'folder', ?)
      `);
      const info = await insertStmt.run(part, currentPath, parentId);
      result = { id: info.lastInsertRowid };
    }
    
    parentId = result.id;
    currentPath = joinPath(currentPath, part);
  }
}

router.post('/check-md5', async (req, res) => {
  try {
    const { md5, name, size, filePath } = req.body;
    
    if (!md5) {
      return res.status(400).json({ error: 'MD5 is required' });
    }

    const existingFile = await db.prepare(`
      SELECT * FROM files 
      WHERE md5 = ? AND type = 'file' AND deleted = 0
      LIMIT 1
    `).get(md5);

    if (existingFile) {
      const targetPath = normalizePath(filePath || '/');
      const targetFileName = name || existingFile.name;
      
      await ensureFoldersExist(targetPath);
      
      const checkExisting = await db.prepare(`
        SELECT id FROM files 
        WHERE path = ? AND name = ? AND type = 'file' AND deleted = 0
      `).get(targetPath, targetFileName);
      
      if (checkExisting) {
        return res.json({ 
          exists: true, 
          quickUpload: false,
          message: 'File already exists in target location',
          file: checkExisting
        });
      }

      const storageFileName = path.basename(existingFile.storage_path);
      const newStoragePath = path.join(getFilesPath(), storageFileName);
      
      if (existingFile.storage_path !== newStoragePath) {
        fs.copySync(existingFile.storage_path, newStoragePath);
      }
      
      const parentId = await getParentId(targetPath);
      const insertStmt = db.prepare(`
        INSERT INTO files (name, path, type, size, md5, parent_id, storage_path)
        VALUES (?, ?, 'file', ?, ?, ?, ?)
      `);
      
      const info = await insertStmt.run(
        targetFileName,
        targetPath,
        existingFile.size,
        md5,
        parentId,
        newStoragePath
      );
      
      await db.prepare('DELETE FROM upload_tasks WHERE file_md5 = ?').run(md5);
      
      await logOperation('quick_upload', info.lastInsertRowid, targetFileName, {
        size: existingFile.size,
        md5,
        targetPath
      }, req);
      
      return res.json({
        exists: true,
        quickUpload: true,
        message: 'File uploaded successfully via MD5 match',
        fileId: info.lastInsertRowid
      });
    }

    const uploadTask = await db.prepare(`
      SELECT * FROM upload_tasks 
      WHERE file_md5 = ? AND status IN ('pending', 'uploading')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(md5);

    if (uploadTask) {
      return res.json({
        exists: false,
        hasTask: true,
        taskId: uploadTask.id,
        uploadedChunks: JSON.parse(uploadTask.uploaded_chunks || '[]'),
        totalChunks: uploadTask.total_chunks,
        chunkSize: uploadTask.chunk_size
      });
    }

    res.json({
      exists: false,
      hasTask: false,
      message: 'No matching file found, upload required'
    });
  } catch (error) {
    console.error('Check MD5 error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/init', async (req, res) => {
  try {
    const { md5, name, size, chunkSize, filePath } = req.body;
    
    if (!md5 || !name || !size || !chunkSize) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const targetPath = normalizePath(filePath || '/');
    const totalChunks = Math.ceil(size / chunkSize);
    
    await ensureFoldersExist(targetPath);

    const existingTask = await db.prepare(`
      SELECT * FROM upload_tasks 
      WHERE file_md5 = ? AND status IN ('pending', 'uploading')
      LIMIT 1
    `).get(md5);

    if (existingTask) {
      return res.json({
        taskId: existingTask.id,
        uploadedChunks: JSON.parse(existingTask.uploaded_chunks || '[]'),
        totalChunks,
        chunkSize
      });
    }

    const taskDir = path.join(getChunksPath(), md5);
    fs.ensureDirSync(taskDir);

    const parentId = await getParentId(targetPath);
    const stmt = db.prepare(`
      INSERT INTO upload_tasks 
      (file_md5, file_name, file_size, chunk_size, total_chunks, parent_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    
    const info = await stmt.run(md5, name, size, chunkSize, totalChunks, parentId);

    res.json({
      taskId: info.lastInsertRowid,
      uploadedChunks: [],
      totalChunks,
      chunkSize
    });
  } catch (error) {
    console.error('Init upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { md5, chunkIndex, totalChunks } = req.body;
    
    if (!md5 || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const task = await db.prepare(`
      SELECT * FROM upload_tasks WHERE file_md5 = ? AND status IN ('pending', 'uploading')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(md5);

    if (!task) {
      return res.status(404).json({ error: 'Upload task not found, please initialize first' });
    }

    const chunkDir = path.join(getChunksPath(), md5);
    const chunkPath = path.join(chunkDir, `${chunkIndex}`);
    
    fs.writeFileSync(chunkPath, req.file.buffer);

    const uploadedChunks = JSON.parse(task.uploaded_chunks || '[]');
    const chunkIdx = parseInt(chunkIndex);
    
    if (!uploadedChunks.includes(chunkIdx)) {
      uploadedChunks.push(chunkIdx);
      uploadedChunks.sort((a, b) => a - b);
    }

    await db.prepare(`
      UPDATE upload_tasks 
      SET uploaded_chunks = ?, status = 'uploading', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(uploadedChunks), task.id);

    const isComplete = uploadedChunks.length === task.total_chunks;

    res.json({
      success: true,
      chunkIndex: chunkIdx,
      uploaded: uploadedChunks.length,
      total: task.total_chunks,
      isComplete
    });
  } catch (error) {
    console.error('Upload chunk error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/complete', async (req, res) => {
  try {
    const { md5, filePath } = req.body;
    
    if (!md5) {
      return res.status(400).json({ error: 'MD5 is required' });
    }

    const task = await db.prepare(`
      SELECT * FROM upload_tasks WHERE file_md5 = ? 
      ORDER BY created_at DESC
      LIMIT 1
    `).get(md5);

    if (!task) {
      return res.status(404).json({ error: 'Upload task not found' });
    }

    const uploadedChunks = JSON.parse(task.uploaded_chunks || '[]');
    if (uploadedChunks.length !== task.total_chunks) {
      return res.status(400).json({ 
        error: 'Not all chunks uploaded',
        uploaded: uploadedChunks.length,
        total: task.total_chunks
      });
    }

    const targetPath = normalizePath(filePath || '/');
    const chunkDir = path.join(getChunksPath(), md5);
    const storageFileName = `${md5}_${uuidv4().slice(0, 8)}${path.extname(task.file_name)}`;
    const storageFilePath = path.join(getFilesPath(), storageFileName);
    
    fs.ensureDirSync(getFilesPath());

    const writeStream = fs.createWriteStream(storageFilePath);
    
    for (let i = 0; i < task.total_chunks; i++) {
      const chunkPath = path.join(chunkDir, String(i));
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }
    
    writeStream.end();
    
    writeStream.on('finish', async () => {
      const fileHash = crypto.createHash('md5');
      const fileStream = fs.createReadStream(storageFilePath);
      
      fileStream.on('data', (data) => fileHash.update(data));
      fileStream.on('end', async () => {
        const computedMd5 = fileHash.digest('hex');
        
        if (computedMd5 !== md5) {
          fs.removeSync(storageFilePath);
          fs.removeSync(chunkDir);
          await db.prepare('UPDATE upload_tasks SET status = ? WHERE id = ?').run('failed', task.id);
          return res.status(500).json({ error: 'MD5 verification failed' });
        }

        await ensureFoldersExist(targetPath);
        const parentId = await getParentId(targetPath);
        const fileSize = fs.statSync(storageFilePath).size;

        const insertStmt = db.prepare(`
          INSERT INTO files (name, path, type, size, md5, parent_id, storage_path)
          VALUES (?, ?, 'file', ?, ?, ?, ?)
        `);

        const info = await insertStmt.run(
          task.file_name,
          targetPath,
          fileSize,
          md5,
          parentId,
          storageFilePath
        );

        await db.prepare('UPDATE upload_tasks SET status = ? WHERE id = ?').run('completed', task.id);
        
        setTimeout(() => {
          try { fs.removeSync(chunkDir); } catch (e) {}
        }, 5000);

        await logOperation('upload', info.lastInsertRowid, task.file_name, {
          size: fileSize,
          md5,
          targetPath
        }, req);

        res.json({
          success: true,
          fileId: info.lastInsertRowid,
          fileName: task.file_name,
          size: fileSize
        });
      });
      
      fileStream.on('error', (err) => {
        console.error('File read error:', err);
        res.status(500).json({ error: err.message });
      });
    });
    
    writeStream.on('error', (err) => {
      console.error('File write error:', err);
      res.status(500).json({ error: err.message });
    });

  } catch (error) {
    console.error('Complete upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
