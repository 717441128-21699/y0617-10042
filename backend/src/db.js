import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;
let dbPath = null;

const defaultData = {
  files: [],
  upload_tasks: [],
  shares: [],
  operation_logs: [],
  counters: {
    files: 1,
    upload_tasks: 1,
    shares: 1,
    operation_logs: 1
  }
};

async function init(customDbPath) {
  dbPath = customDbPath || path.resolve(__dirname, '../../', process.env.DB_PATH || './storage/db.json');
  fs.ensureDirSync(path.dirname(dbPath));
  
  const adapter = new JSONFile(dbPath);
  db = new Low(adapter, defaultData);
  
  await db.read();
  
  if (!db.data || !db.data.files || db.data.files.length === 0) {
    db.data = { ...defaultData };
    await db.write();
  }
}

function getNextId(collection) {
  const id = db.data.counters[collection];
  db.data.counters[collection] = id + 1;
  return id;
}

function prepare(sql) {
  const dbInstance = db;
  
  return {
    async get(...params) {
      await dbInstance.read();
      const result = executeQuery(sql, params, 'one');
      return result;
    },
    
    async all(...params) {
      await dbInstance.read();
      const result = executeQuery(sql, params, 'all');
      return result;
    },
    
    async run(...params) {
      await dbInstance.read();
      const result = executeQuery(sql, params, 'run');
      await dbInstance.write();
      return result;
    }
  };
}

function executeQuery(sql, params, mode) {
  sql = sql.trim();
  
  if (sql.toUpperCase().startsWith('SELECT')) {
    return handleSelect(sql, params, mode);
  } else if (sql.toUpperCase().startsWith('INSERT')) {
    return handleInsert(sql, params);
  } else if (sql.toUpperCase().startsWith('UPDATE')) {
    return handleUpdate(sql, params);
  } else if (sql.toUpperCase().startsWith('DELETE')) {
    return handleDelete(sql, params);
  } else if (sql.toUpperCase().startsWith('CREATE')) {
    return { changes: 0 };
  } else if (sql.toUpperCase().startsWith('PRAGMA')) {
    return { changes: 0 };
  }
  return null;
}

function normalizeItem(table, item) {
  const now = new Date().toISOString();
  const normalized = { ...item };
  
  if (table === 'files') {
    if (normalized.deleted === undefined) normalized.deleted = 0;
    if (normalized.created_at === undefined) normalized.created_at = now;
    if (normalized.updated_at === undefined) normalized.updated_at = now;
    if (normalized.size === undefined) normalized.size = 0;
  } else if (table === 'shares') {
    if (normalized.view_count === undefined) normalized.view_count = 0;
    if (normalized.download_count === undefined) normalized.download_count = 0;
    if (normalized.created_at === undefined) normalized.created_at = now;
    if (normalized.updated_at === undefined) normalized.updated_at = now;
    if (normalized.revoked === undefined) normalized.revoked = 0;
  } else if (table === 'upload_tasks') {
    if (normalized.uploaded_chunks === undefined) normalized.uploaded_chunks = '[]';
    if (normalized.status === undefined) normalized.status = 'pending';
    if (normalized.created_at === undefined) normalized.created_at = now;
    if (normalized.updated_at === undefined) normalized.updated_at = now;
  }
  
  return normalized;
}

function handleSelect(sql, params, mode) {
  const tableMatch = sql.match(/FROM\s+(\w+)/i);
  if (!tableMatch) return mode === 'all' ? [] : null;
  
  const table = tableMatch[1];
  let data = [...db.data[table]];

  data = data.map(item => normalizeItem(table, item));
  
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/is);
  
  if (whereMatch) {
    let whereClause = whereMatch[1].trim();
    data = applyWhere(data, whereClause, params);
  }
  
  const orderMatch = sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/is);
  if (orderMatch) {
    const orderClause = orderMatch[1].trim();
    data = applyOrderBy(data, orderClause);
  }
  
  const limitOffsetMatch = sql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
  if (limitOffsetMatch) {
    const limit = parseInt(limitOffsetMatch[1]);
    const offset = limitOffsetMatch[2] ? parseInt(limitOffsetMatch[2]) : 0;
    data = data.slice(offset, offset + limit);
  }
  
  if (sql.includes('COUNT(*)') && data.length > 0) {
    if (mode === 'one') {
      return { count: data.length };
    }
  }
  
  if (sql.includes('COUNT(*)') && mode === 'one') {
    return { count: data.length };
  }
  
  if (mode === 'one') {
    return data[0] || null;
  }
  
  return data;
}

function applyWhere(data, whereClause, params) {
  let paramIndex = 0;
  
  const conditions = parseWhereClause(whereClause);
  
  return data.filter(item => {
    paramIndex = 0;
    return evaluateCondition(item, conditions, params, () => paramIndex++);
  });
}

function parseWhereClause(clause) {
  const parts = clause.split(/\s+AND\s+/i);
  return parts.map(part => part.trim());
}

function evaluateCondition(item, conditions, params, getNextParam) {
  return conditions.every(cond => {
    if (cond.includes('IS NULL')) {
      const field = cond.replace(/\s+IS\s+NULL/i, '').trim();
      return item[field] === null || item[field] === undefined;
    }
    
    if (cond.includes('IN (')) {
      const inMatch = cond.match(/(\w+)\s+IN\s*\(([^)]+)\)/i);
      if (inMatch) {
        const field = inMatch[1];
        let valuesStr = inMatch[2].trim();
        const values = valuesStr.split(',').map(v => {
          v = v.trim();
          if (v === '?') {
            return params[getNextParam()];
          } else if (v.startsWith("'") && v.endsWith("'")) {
            return v.slice(1, -1);
          }
          return v;
        });
        return values.includes(item[field]);
      }
    }
    
    const match = cond.match(/(\w+)\s*(>=|<=|!=|<>|=|>|<|LIKE)\s*(.+)/i);
    if (!match) return true;
    
    const field = match[1];
    const op = match[2].toUpperCase();
    let value = match[3].trim();
    
    if (value === '?') {
      value = params[getNextParam()];
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (!isNaN(value)) {
      value = parseFloat(value);
    } else if (value === 'NULL') {
      value = null;
    }
    
    const itemValue = item[field];
    
    switch (op) {
      case '=': return itemValue === value;
      case '!=':
      case '<>': return itemValue !== value;
      case '>': return itemValue > value;
      case '<': return itemValue < value;
      case '>=': return itemValue >= value;
      case '<=': return itemValue <= value;
      case 'LIKE': 
        if (typeof itemValue === 'string' && typeof value === 'string') {
          const pattern = value.replace(/%/g, '.*');
          return new RegExp(pattern, 'i').test(itemValue);
        }
        return false;
      default: return true;
    }
  });
}

function applyOrderBy(data, orderClause) {
  const parts = orderClause.split(',');
  return data.sort((a, b) => {
    for (const part of parts) {
      const [field, direction] = part.trim().split(/\s+/);
      const dir = (direction || 'ASC').toUpperCase();
      const modifier = dir === 'DESC' ? -1 : 1;
      
      if (a[field] > b[field]) return modifier;
      if (a[field] < b[field]) return -modifier;
    }
    return 0;
  });
}

function handleInsert(sql, params) {
  const tableMatch = sql.match(/INTO\s+(\w+)\s*\(([^)]+)\)/i);
  if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
  
  const table = tableMatch[1];
  const columns = tableMatch[2].split(',').map(c => c.trim());
  
  const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
  if (!valuesMatch) return { changes: 0, lastInsertRowid: 0 };
  
  const values = valuesMatch[1].split(',').map(v => v.trim());
  
  const newItem = {};
  let paramIndex = 0;
  
  columns.forEach((col, i) => {
    let value = values[i];
    if (value === '?') {
      value = params[paramIndex++];
    } else if (value === "CURRENT_TIMESTAMP") {
      value = new Date().toISOString();
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.match(/^\d+$/)) {
      value = parseInt(value);
    }
    
    newItem[col] = value;
  });
  
  if (!newItem.id) {
    newItem.id = getNextId(table);
  }

  const now = new Date().toISOString();
  
  if (table === 'files') {
    if (newItem.deleted === undefined) newItem.deleted = 0;
    if (newItem.created_at === undefined) newItem.created_at = now;
    if (newItem.updated_at === undefined) newItem.updated_at = now;
    if (newItem.size === undefined) newItem.size = 0;
  } else if (table === 'shares') {
    if (newItem.view_count === undefined) newItem.view_count = 0;
    if (newItem.download_count === undefined) newItem.download_count = 0;
    if (newItem.created_at === undefined) newItem.created_at = now;
    if (newItem.updated_at === undefined) newItem.updated_at = now;
    if (newItem.revoked === undefined) newItem.revoked = 0;
  } else if (table === 'operation_logs') {
    if (newItem.created_at === undefined) newItem.created_at = now;
  } else if (table === 'upload_tasks') {
    if (newItem.uploaded_chunks === undefined) newItem.uploaded_chunks = '[]';
    if (newItem.status === undefined) newItem.status = 'pending';
    if (newItem.created_at === undefined) newItem.created_at = now;
    if (newItem.updated_at === undefined) newItem.updated_at = now;
  }

  db.data[table].push(newItem);
  
  return {
    changes: 1,
    lastInsertRowid: newItem.id
  };
}

function handleUpdate(sql, params) {
  const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
  if (!tableMatch) return { changes: 0 };
  
  const table = tableMatch[1];
  
  const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/is);
  if (!setMatch) return { changes: 0 };
  
  const whereMatch = sql.match(/WHERE\s+(.+)$/is);
  
  let paramIndex = 0;
  const setClauses = parseSetClause(setMatch[1]);
  
  let data = db.data[table];
  let updatedCount = 0;
  
  const conditions = whereMatch ? parseWhereClause(whereMatch[1]) : null;
  
  data.forEach(item => {
    let pIndex = 0;
    const normalizedItem = normalizeItem(table, item);
    const shouldUpdate = !conditions || evaluateCondition(normalizedItem, conditions, params, () => pIndex++);
    
    if (shouldUpdate) {
      setClauses.forEach(({ field, value }) => {
        if (value === '?') {
          item[field] = params[paramIndex++];
        } else if (value === "CURRENT_TIMESTAMP") {
          item[field] = new Date().toISOString();
        } else if (value.includes('+') || value.includes('-')) {
          const mathMatch = value.match(/(\w+)\s*([+-])\s*(\d+)/);
          if (mathMatch) {
            const srcField = mathMatch[1];
            const op = mathMatch[2];
            const num = parseInt(mathMatch[3]);
            item[field] = op === '+' ? (item[srcField] || 0) + num : (item[srcField] || 0) - num;
          } else {
            item[field] = value;
          }
        } else {
          item[field] = value;
        }
      });
      updatedCount++;
    }
  });
  
  return { changes: updatedCount };
}

function parseSetClause(clause) {
  const parts = clause.split(',');
  return parts.map(part => {
    const [field, ...rest] = part.split('=');
    return { field: field.trim(), value: rest.join('=').trim() };
  });
}

function handleDelete(sql, params) {
  const tableMatch = sql.match(/FROM\s+(\w+)/i);
  if (!tableMatch) return { changes: 0 };
  
  const table = tableMatch[1];
  
  const whereMatch = sql.match(/WHERE\s+(.+)$/is);
  
  let paramIndex = 0;
  const conditions = whereMatch ? parseWhereClause(whereMatch[1]) : null;
  
  const originalLength = db.data[table].length;
  
  if (!conditions) {
    db.data[table] = [];
  } else {
    db.data[table] = db.data[table].filter(item => {
      paramIndex = 0;
      const normalizedItem = normalizeItem(table, item);
      return !evaluateCondition(normalizedItem, conditions, params, () => paramIndex++);
    });
  }
  
  const deletedCount = originalLength - db.data[table].length;
  
  return { changes: deletedCount };
}

function exec(sql) {
  const statements = sql.split(';').filter(s => s.trim());
  statements.forEach(stmt => {
    executeQuery(stmt.trim(), [], 'run');
  });
  db.write();
}

function pragma() {
  return;
}

const dbInstance = {
  init,
  prepare,
  exec,
  pragma,
  get data() {
    return db ? db.data : null;
  }
};

export default dbInstance;
