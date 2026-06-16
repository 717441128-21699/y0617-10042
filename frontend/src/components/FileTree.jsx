import React, { useState } from 'react';
import { FolderOutlined, FolderOpenOutlined } from '@ant-design/icons';
import useStore from '../store';
import { joinPath } from '../utils/path';

function TreeNode({ node, level = 0, currentPath, onSelect }) {
  const [expanded, setExpanded] = useState(level < 2);
  const nodePath = joinPath(node.path, node.name);
  const isActive = nodePath === currentPath;
  const hasChildren = node.children && node.children.length > 0;
  const folderChildren = hasChildren ? node.children.filter(c => c.type === 'folder') : [];

  const handleClick = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
    onSelect(nodePath);
  };

  return (
    <div>
      <div 
        className={`tree-node ${isActive ? 'active' : ''}`}
        onClick={handleClick}
      >
        <span style={{ width: 16, display: 'inline-block' }}>
          {hasChildren && (
            expanded ? '▼' : '▶'
          )}
        </span>
        {expanded ? (
          <FolderOpenOutlined style={{ color: '#faad14' }} />
        ) : (
          <FolderOutlined style={{ color: '#faad14' }} />
        )}
        <span style={{ fontSize: 13 }}>{node.name}</span>
      </div>
      {expanded && folderChildren.length > 0 && (
        <div className="tree-children">
          {folderChildren.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              currentPath={currentPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTree() {
  const { tree, currentPath, setCurrentPath, fetchFiles } = useStore();

  const handleSelect = (path) => {
    setCurrentPath(path);
    fetchFiles(path);
  };

  const rootPath = '/';
  const rootFolders = tree.filter(n => n.type === 'folder' && n.path === '/');
  const rootActive = rootPath === currentPath;

  return (
    <div>
      <div 
        className={`tree-node ${rootActive ? 'active' : ''}`}
        onClick={() => handleSelect('/')}
        style={{ fontWeight: 500 }}
      >
        <span style={{ width: 16, display: 'inline-block' }}>
          {tree.length > 0 ? '▼' : '▶'}
        </span>
        <FolderOutlined style={{ color: '#faad14' }} />
        <span>根目录</span>
      </div>
      
      <div className="tree-children">
        {rootFolders.map(node => (
          <TreeNode
            key={node.id}
            node={node}
            currentPath={currentPath}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default FileTree;
