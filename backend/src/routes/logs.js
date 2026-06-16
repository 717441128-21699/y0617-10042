import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, action, operation, fileId, startDate, endDate } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);
    
    const filterOperation = action || operation;
    
    let whereClauses = [];
    let params = [];
    
    if (filterOperation) {
      whereClauses.push('operation = ?');
      params.push(filterOperation);
    }
    
    if (fileId) {
      whereClauses.push('file_id = ?');
      params.push(fileId);
    }
    
    if (startDate) {
      whereClauses.push('created_at >= ?');
      params.push(startDate);
    }
    
    if (endDate) {
      whereClauses.push('created_at <= ?');
      params.push(endDate);
    }
    
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const countStmt = db.prepare(`
      SELECT * FROM operation_logs ${whereSql}
    `);
    const allLogs = await countStmt.all(...params);
    const total = allLogs.length;
    
    const logsStmt = db.prepare(`
      SELECT * FROM operation_logs 
      ${whereSql}
      ORDER BY created_at DESC
    `);
    let logs = await logsStmt.all(...params);
    
    logs = logs.slice(offset, offset + limit);
    
    logs = logs.map(log => ({
      ...log,
      details: log.details ? JSON.parse(log.details) : null,
      ip: log.ip_address
    }));
    
    res.json({
      logs,
      pagination: {
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(total / pageSize)
      },
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { days = 7, startDate, endDate } = req.query;
    
    let startDateParam;
    if (startDate) {
      startDateParam = startDate;
    } else {
      const date = new Date();
      date.setDate(date.getDate() - parseInt(days));
      startDateParam = date.toISOString();
    }
    
    const stmt = db.prepare(`
      SELECT * FROM operation_logs 
      WHERE created_at >= ?
      ORDER BY created_at DESC
    `);
    const logs = await stmt.all(startDateParam);
    
    const operationCounts = {};
    let totalUploadSize = 0;
    let totalOperations = 0;
    let totalUploads = 0;
    let totalDownloads = 0;
    let totalShares = 0;
    let totalDeletes = 0;
    
    logs.forEach(log => {
      totalOperations++;
      operationCounts[log.operation] = (operationCounts[log.operation] || 0) + 1;
      
      if (log.operation === 'upload' || log.operation === 'quick_upload') {
        totalUploads++;
        if (log.details) {
          try {
            const details = JSON.parse(log.details);
            if (details.size) {
              totalUploadSize += details.size;
            }
          } catch (e) {}
        }
      }
      
      if (log.operation === 'download' || log.operation === 'share_download') {
        totalDownloads++;
      }
      
      if (log.operation === 'create_share' || log.operation === 'update_share' || log.operation === 'revoke_share' || log.operation === 'share_view') {
        totalShares++;
      }
      
      if (log.operation === 'delete') {
        totalDeletes++;
      }
    });
    
    const stats = Object.entries(operationCounts)
      .map(([operation, count]) => ({ operation, count }))
      .sort((a, b) => b.count - a.count);
    
    res.json({
      stats,
      total: totalOperations,
      totalUploadSize,
      periodDays: parseInt(days) || 0,
      totalStats: {
        totalOperations,
        totalUploads,
        totalDownloads,
        totalShares,
        totalDeletes,
        totalUploadSize
      }
    });
  } catch (error) {
    console.error('Get logs stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const stmt = db.prepare(`
      SELECT * FROM operation_logs 
      ORDER BY created_at DESC
      LIMIT ?
    `);
    let logs = await stmt.all(parseInt(limit));
    
    logs = logs.map(log => ({
      ...log,
      details: log.details ? JSON.parse(log.details) : null,
      ip: log.ip_address
    }));
    
    res.json(logs);
  } catch (error) {
    console.error('Get recent logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
