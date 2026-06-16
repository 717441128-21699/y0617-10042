import db from '../db.js';

export async function logOperation(operation, fileId, fileName, details = {}, req = {}) {
  try {
    const ip = req.headers?.['x-forwarded-for'] || 
               req.headers?.['x-real-ip'] || 
               req.socket?.remoteAddress || 
               'unknown';
    
    const userAgent = req.headers?.['user-agent'] || 'unknown';
    
    const stmt = db.prepare(`
      INSERT INTO operation_logs (operation, file_id, file_name, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    await stmt.run(
      operation,
      fileId || null,
      fileName || null,
      JSON.stringify(details),
      ip,
      userAgent
    );
  } catch (error) {
    console.error('Log operation error:', error);
  }
}

export function accessLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`
    );
  });
  
  next();
}
