import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import db from '../db.js';
import { logOperation } from '../middleware/logger.js';
import { normalizePath, joinPath, getParentPath } from '../utils/path.js';

const router = express.Router();

function buildTree(files) {
  const map = new Map();
  const roots = [];
  
  files.forEach(file => {
    file.children = [];
    map.set(file.id, file);
  });
  
  files.forEach(file => {
    if (file.parent_id === null) {
      roots.push(file);
    } else {
      const parent = map.get(file.parent_id);
      if (parent) {
        parent.children.push(file);
      } else {
        roots.push(file);
      }
    }
  });
  
  return roots;
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

router.get('/tree', async (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, name, path, type, size, md5, parent_id, created_at, updated_at
      FROM files 
      WHERE deleted = 0
      ORDER BY type DESC, name ASC
    `);
    const files = await stmt.all();
    
    const tree = buildTree(files);
    res.json(tree);
  } catch (error) {
    console.error('Get tree error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/list', async (req, res) => {
  try {
    const { path: filePath = '/' } = req.query;
    const normalizedPath = normalizePath(filePath);
    
    let parentId = null;
    if (normalizedPath !== '/') {
      const parts = normalizedPath.split('/').filter(Boolean);
      let currentPath = '/';
      
      for (const part of parts) {
        const folderStmt = db.prepare(`
          SELECT id FROM files 
          WHERE path = ? AND name = ? AND type = 'folder' AND deleted = 0
        `);
        const folder = await folderStmt.get(currentPath, part);
        
        if (!folder) {
          return res.status(404).json({ error: 'Folder not found' });
        }
        parentId = folder.id;
        currentPath = joinPath(currentPath, part);
      }
    }
    
    let files;
    if (parentId === null) {
      const stmt = db.prepare(`
        SELECT id, name, path, type, size, md5, parent_id, created_at, updated_at
        FROM files 
        WHERE parent_id IS NULL AND deleted = 0
        ORDER BY type DESC, name ASC
      `);
      files = await stmt.all();
    } else {
      const stmt = db.prepare(`
        SELECT id, name, path, type, size, md5, parent_id, created_at, updated_at
        FROM files 
        WHERE parent_id = ? AND deleted = 0
        ORDER BY type DESC, name ASC
      `);
      files = await stmt.all(parentId);
    }
    
    const breadcrumbs = [];
    if (normalizedPath !== '/') {
      const parts = normalizedPath.split('/').filter(Boolean);
      let currentPath = '/';
      breadcrumbs.push({ name: '根目录', path: '/' });
      
      for (const part of parts) {
        currentPath = joinPath(currentPath, part);
        breadcrumbs.push({ name: part, path: currentPath });
      }
    } else {
      breadcrumbs.push({ name: '根目录', path: '/' });
    }
    
    res.json({
      files,
      breadcrumbs,
      currentPath: normalizedPath
    });
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const stmt = db.prepare(`
      SELECT id, name, path, type, size, md5, parent_id, storage_path, created_at, updated_at
      FROM files 
      WHERE id = ? AND deleted = 0
    `);
    const file = await stmt.get(id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.json(file);
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/folder', async (req, res) => {
  try {
    const { name, path: filePath = '/' } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    const normalizedPath = normalizePath(filePath);
    let parentId = null;
    
    if (normalizedPath !== '/') {
      const parts = normalizedPath.split('/').filter(Boolean);
      let currentPath = '/';
      
      for (const part of parts) {
        const folderStmt = db.prepare(`
          SELECT id FROM files 
          WHERE path = ? AND name = ? AND type = 'folder' AND deleted = 0
        `);
        const folder = await folderStmt.get(currentPath, part);
        
        if (!folder) {
          const insertStmt = db.prepare(`
            INSERT INTO files (name, path, type, parent_id)
            VALUES (?, ?, 'folder', ?)
          `);
          const info = await insertStmt.run(part, currentPath, parentId);
          parentId = info.lastInsertRowid;
        } else {
          parentId = folder.id;
        }
        currentPath = joinPath(currentPath, part);
      }
    }
    
    let existing;
    if (parentId === null) {
      const checkStmt = db.prepare(`
        SELECT id FROM files 
        WHERE parent_id IS NULL AND name = ? AND type = 'folder' AND deleted = 0
      `);
      existing = await checkStmt.get(name);
    } else {
      const checkStmt = db.prepare(`
        SELECT id FROM files 
        WHERE parent_id = ? AND name = ? AND type = 'folder' AND deleted = 0
      `);
      existing = await checkStmt.get(parentId, name);
    }
    
    if (existing) {
      return res.status(409).json({ error: 'Folder already exists' });
    }
    
    const stmt = db.prepare(`
      INSERT INTO files (name, path, type, parent_id)
      VALUES (?, ?, 'folder', ?)
    `);
    
    const info = await stmt.run(name, normalizedPath, parentId);
    
    logOperation('create_folder', info.lastInsertRowid, name, {
      path: normalizedPath
    }, req);
    
    res.json({
      id: info.lastInsertRowid,
      name,
      path: normalizedPath,
      type: 'folder'
    });
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetPath } = req.body;
    
    if (!targetPath && targetPath !== '/') {
      return res.status(400).json({ error: 'Target path is required' });
    }
    
    const getStmt = db.prepare(`
      SELECT * FROM files WHERE id = ? AND deleted = 0
    `);
    const file = await getStmt.get(id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const normalizedTargetPath = normalizePath(targetPath);
    let targetParentId = null;
    
    if (normalizedTargetPath !== '/') {
      const parts = normalizedTargetPath.split('/').filter(Boolean);
      let currentPath = '/';
      
      for (const part of parts) {
        const folderStmt = db.prepare(`
          SELECT id FROM files 
          WHERE path = ? AND name = ? AND type = 'folder' AND deleted = 0
        `);
        const folder = await folderStmt.get(currentPath, part);
        
        if (!folder) {
          return res.status(404).json({ error: 'Target folder not found' });
        }
        targetParentId = folder.id;
        currentPath = joinPath(currentPath, part);
      }
    }
    
    if (file.parent_id === targetParentId) {
      return res.json({ message: 'File already in target location' });
    }
    
    let existing;
    if (targetParentId === null) {
      const checkStmt = db.prepare(`
        SELECT id FROM files 
        WHERE parent_id IS NULL AND name = ? AND type = ? AND deleted = 0
      `);
      existing = await checkStmt.get(file.name, file.type);
    } else {
      const checkStmt = db.prepare(`
        SELECT id FROM files 
        WHERE parent_id = ? AND name = ? AND type = ? AND deleted = 0
      `);
      existing = await checkStmt.get(targetParentId, file.name, file.type);
    }
    
    if (existing) {
      return res.status(409).json({ error: 'A file/folder with the same name already exists in target location' });
    }
    
    const oldPath = joinPath(file.path, file.name);
    const newPath = joinPath(normalizedTargetPath, file.name);
    
    const updateStmt = db.prepare(`
      UPDATE files 
      SET path = ?, parent_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    await updateStmt.run(normalizedTargetPath, targetParentId, id);
    
    if (file.type === 'folder') {
      const updateChildren = async (parentPath, newParentPath, parentId) => {
        let children;
        const childrenStmt = db.prepare(`
          SELECT * FROM files WHERE parent_id = ? AND deleted = 0
        `);
        children = await childrenStmt.all(parentId);
        
        for (const child of children) {
          const childNewPath = joinPath(newParentPath, child.name);
          const updateChildStmt = db.prepare(`
            UPDATE files 
            SET path = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          await updateChildStmt.run(newParentPath, child.id);
          
          if (child.type === 'folder') {
            await updateChildren(joinPath(parentPath, child.name), childNewPath, child.id);
          }
        }
      };
      
      await updateChildren(oldPath, newPath, id);
    }
    
    logOperation('move', id, file.name, {
      from: oldPath,
      to: newPath
    }, req);
    
    res.json({ success: true, message: 'Moved successfully' });
  } catch (error) {
    console.error('Move error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/rename', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'New name is required' });
    }
    
    const getStmt = db.prepare(`
      SELECT * FROM files WHERE id = ? AND deleted = 0
    `);
    const file = await getStmt.get(id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (file.name === name) {
      return res.json({ message: 'Name is the same' });
    }
    
    let existing;
    if (file.parent_id === null) {
      const checkStmt = db.prepare(`
        SELECT id FROM files 
        WHERE parent_id IS NULL AND name = ? AND type = ? AND deleted = 0
      `);
      existing = await checkStmt.get(name, file.type);
    } else {
      const checkStmt = db.prepare(`
        SELECT id FROM files 
        WHERE parent_id = ? AND name = ? AND type = ? AND deleted = 0
      `);
      existing = await checkStmt.get(file.parent_id, name, file.type);
    }
    
    if (existing) {
      return res.status(409).json({ error: 'A file/folder with the same name already exists' });
    }
    
    const oldName = file.name;
    const oldPath = joinPath(file.path, file.name);
    
    const updateStmt = db.prepare(`
      UPDATE files 
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    await updateStmt.run(name, id);
    
    if (file.type === 'folder') {
      const newPath = joinPath(file.path, name);
      
      const updateChildren = async (oldParentPath, newParentPath, parentId) => {
        let children;
        const childrenStmt = db.prepare(`
          SELECT * FROM files WHERE parent_id = ? AND deleted = 0
        `);
        children = await childrenStmt.all(parentId);
        
        for (const child of children) {
          const childOldPath = joinPath(oldParentPath, child.name);
          const childNewPath = joinPath(newParentPath, child.name);
          
          const updateChildStmt = db.prepare(`
            UPDATE files 
            SET path = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          await updateChildStmt.run(newParentPath, child.id);
          
          if (child.type === 'folder') {
            await updateChildren(childOldPath, childNewPath, child.id);
          }
        }
      };
      
      await updateChildren(oldPath, newPath, id);
    }
    
    logOperation('rename', id, name, {
      oldName,
      newName: name,
      path: file.path
    }, req);
    
    res.json({ success: true, message: 'Renamed successfully' });
  } catch (error) {
    console.error('Rename error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const getStmt = db.prepare(`
      SELECT * FROM files WHERE id = ? AND deleted = 0
    `);
    const file = await getStmt.get(id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const filePaths = [];
    
    const collectFiles = async (fileId) => {
      const getFStmt = db.prepare('SELECT * FROM files WHERE id = ?');
      const f = await getFStmt.get(fileId);
      if (f && f.type === 'file' && f.storage_path) {
        filePaths.push(f.storage_path);
      }
      
      let children;
      const childrenStmt = db.prepare(`
        SELECT id FROM files WHERE parent_id = ? AND deleted = 0
      `);
      children = await childrenStmt.all(fileId);
      
      for (const child of children) {
        await collectFiles(child.id);
      }
    };
    
    await collectFiles(id);
    
    const deleteStmt = db.prepare(`
      UPDATE files SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    await deleteStmt.run(id);
    
    const deleteChildren = async (parentId) => {
      let children;
      const childrenStmt = db.prepare(`
        SELECT id FROM files WHERE parent_id = ? AND deleted = 0
      `);
      children = await childrenStmt.all(parentId);
      
      for (const child of children) {
        const deleteChildStmt = db.prepare(`
          UPDATE files SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `);
        await deleteChildStmt.run(child.id);
        await deleteChildren(child.id);
      }
    };
    
    await deleteChildren(id);
    
    for (const filePath of filePaths) {
      try {
        const countStmt = db.prepare(`
          SELECT COUNT(*) as count FROM files 
          WHERE storage_path = ? AND deleted = 0
        `);
        const result = await countStmt.get(filePath);
        const count = result.count;
        
        if (count === 0) {
          fs.removeSync(filePath);
        }
      } catch (e) {
        console.error('Delete file error:', e);
      }
    }
    
    logOperation('delete', id, file.name, {
      type: file.type,
      path: file.path
    }, req);
    
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
