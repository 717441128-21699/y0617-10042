import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CloudOutlined, HistoryOutlined } from '@ant-design/icons';
import FileTree from './FileTree';
import useStore from '../store';

function Layout({ children }) {
  const location = useLocation();
  const { fetchTree } = useStore();

  React.useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-logo">
          <CloudOutlined style={{ fontSize: 24 }} />
          <span>私有云存储</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Link 
            to="/" 
            style={{ 
              color: location.pathname === '/' ? '#fff' : 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <CloudOutlined /> 文件管理
          </Link>
          <Link 
            to="/logs" 
            style={{ 
              color: location.pathname === '/logs' ? '#fff' : 'rgba(255,255,255,0.7)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <HistoryOutlined /> 操作日志
          </Link>
        </div>
      </header>
      
      <div className="app-content">
        <aside className="sidebar">
          <div className="sidebar-header">
            <strong>目录树</strong>
          </div>
          <div className="sidebar-content">
            <FileTree />
          </div>
        </aside>
        
        <main className="main-panel">
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
