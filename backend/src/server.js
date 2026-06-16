import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config();

import db from './db.js';
import { accessLogger } from './middleware/logger.js';
import uploadRouter from './routes/upload.js';
import filesRouter from './routes/files.js';
import sharesRouter from './routes/shares.js';
import previewRouter from './routes/preview.js';
import logsRouter from './routes/logs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

const getStoragePath = () => path.resolve(process.env.STORAGE_PATH || './storage');
const getChunksPath = () => path.join(getStoragePath(), 'chunks');
const getFilesPath = () => path.join(getStoragePath(), 'files');
const getDbPath = () => path.join(getStoragePath(), 'db.json');

fs.ensureDirSync(getStoragePath());
fs.ensureDirSync(getChunksPath());
fs.ensureDirSync(getFilesPath());

async function initDatabase() {
  try {
    await db.init(getDbPath());
    
    const createFilesTable = db.prepare(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '/',
        type TEXT NOT NULL CHECK(type IN ('file', 'folder')),
        size INTEGER DEFAULT 0,
        md5 TEXT,
        parent_id INTEGER,
        storage_path TEXT,
        deleted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await createFilesTable.run();
    
    const createUploadTasksTable = db.prepare(`
      CREATE TABLE IF NOT EXISTS upload_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_md5 TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        uploaded_chunks TEXT,
        parent_id INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await createUploadTasksTable.run();
    
    const createSharesTable = db.prepare(`
      CREATE TABLE IF NOT EXISTS shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        password TEXT,
        expires_at TEXT NOT NULL,
        view_count INTEGER DEFAULT 0,
        download_count INTEGER DEFAULT 0,
        revoked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await createSharesTable.run();
    
    const createLogsTable = db.prepare(`
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        file_id INTEGER,
        file_name TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await createLogsTable.run();
    
    const md5Index = db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_md5 ON files(md5)`);
    await md5Index.run();
    
    const pathIndex = db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_path ON files(path, name)`);
    await pathIndex.run();
    
    const deletedIndex = db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted)`);
    await deletedIndex.run();
    
    const tokenIndex = db.prepare(`CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token)`);
    await tokenIndex.run();
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(accessLogger);

app.use('/api/upload', uploadRouter);
app.use('/api/files', filesRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/preview', previewRouter);
app.use('/api/logs', logsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/stats', async (req, res) => {
  try {
    const fileCountStmt = db.prepare(`
      SELECT * FROM files WHERE type = 'file' AND deleted = 0
    `);
    const fileCountResult = await fileCountStmt.all();
    const fileCount = fileCountResult.length;
    
    const folderCountStmt = db.prepare(`
      SELECT * FROM files WHERE type = 'folder' AND deleted = 0
    `);
    const folderCountResult = await folderCountStmt.all();
    const folderCount = folderCountResult.length;
    
    const totalSizeStmt = db.prepare(`
      SELECT * FROM files WHERE type = 'file' AND deleted = 0
    `);
    const allFiles = await totalSizeStmt.all();
    const totalSize = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    
    const shareCountStmt = db.prepare(`
      SELECT * FROM shares WHERE revoked = 0
    `);
    const allShares = await shareCountStmt.all();
    const now = new Date();
    const shareCount = allShares.filter(s => new Date(s.expires_at) > now).length;
    
    res.json({
      fileCount,
      folderCount,
      totalSize,
      shareCount
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  私有文件云存储服务已启动`);
      console.log(`  后端地址: http://localhost:${PORT}`);
      console.log(`  存储目录: ${getStoragePath()}`);
      console.log(`  数据库: ${getDbPath()}`);
      console.log(`========================================\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
