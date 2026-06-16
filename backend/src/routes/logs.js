import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, operation, fileId, startDate, endDate } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);
    
    let whereClauses = [];
    let params = [];
    
    if (operation) {
      whereClauses.push('operation = ?');
      params.push(operation);
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
      SELECT COUNT(*) as count FROM operation_logs ${whereSql}
    `);
    const countResult = await countStmt.get(...params);
    const total = countResult.count;
    
    const logsStmt = db.prepare(`
      SELECT * FROM operation_logs 
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const logs = await logsStmt.all(...params, limit, offset);
    
    res.json({
      logs,
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
    const { days = 7 } = req.query;
    
    const date = new Date();
    date.setDate(date.getDate() - parseInt(days));
    const startDate = date.toISOString();
    
    const stmt = db.prepare(`
      SELECT * FROM operation_logs 
      WHERE created_at >= ?
      ORDER BY created_at DESC
    `);
    const logs = await stmt.all(startDate);
    
    const operationCounts = {};
    let totalUploadSize = 0;
    
    logs.forEach(log => {
      operationCounts[log.operation] = (operationCounts[log.operation] || 0) + 1;
      
      if ((log.operation === 'upload' || log.operation === 'quick_upload') && log.details) {
        try {
          const details = JSON.parse(log.details);
          if (details.size) {
            totalUploadSize += details.size;
          }
        } catch (e) {}
      }
    });
    
    const stats = Object.entries(operationCounts)
      .map(([operation, count]) => ({ operation, count }))
      .sort((a, b) => b.count - a.count);
    
    res.json({
      stats,
      total: logs.length,
      totalUploadSize,
      periodDays: parseInt(days)
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
    const logs = await stmt.all(parseInt(limit));
    
    res.json(logs);
  } catch (error) {
    console.error('Get recent logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
