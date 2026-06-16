import React, { useState } from 'react';
import { Modal, Tree, message } from 'antd';
import { FolderOutlined, FolderOpenOutlined } from '@ant-design/icons';
import useStore from '../store';
import { fileApi } from '../api';
import { joinPath } from '../utils/path';

function buildTreeData(nodes, currentFileId) {
  if (!nodes || nodes.length === 0) return [];
  
  return nodes
    .filter(n => n.type === 'folder' && n.id !== currentFileId)
    .map(node => ({
      key: joinPath(node.path, node.name),
      title: node.name,
      icon: <FolderOutlined style={{ color: '#faad14' }} />,
      children: node.children ? buildTreeData(node.children, currentFileId) : [],
      isLeaf: !node.children || node.children.filter(c => c.type === 'folder').length === 0
    }));
}

function MoveDialog({ file, onClose, onSuccess }) {
  const { tree, refresh } = useStore();
  const [selectedPath, setSelectedPath] = useState('/');
  const [loading, setLoading] = useState(false);

  const treeData = [
    {
      key: '/',
      title: '根目录',
      icon: <FolderOutlined style={{ color: '#faad14' }} />,
      children: buildTreeData(tree, file.id)
    }
  ];

  const handleMove = async () => {
    const currentFilePath = joinPath(file.path, file.name);
    if (selectedPath === file.path) {
      message.info('文件已在目标位置');
      onClose();
      return;
    }

    if (selectedPath.startsWith(currentFilePath + '/')) {
      message.error('不能将文件夹移动到其子目录中');
      return;
    }

    try {
      setLoading(true);
      await fileApi.moveFile(file.id, selectedPath);
      message.success('移动成功');
      onSuccess?.();
      onClose();
    } catch (e) {
      message.error(e.response?.data?.error || '移动失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`移动 "${file.name}" 到`}
      open={true}
      onOk={handleMove}
      onCancel={onClose}
      confirmLoading={loading}
      okText="移动"
      width={400}
    >
      <div style={{ marginBottom: 12, color: '#666' }}>
        当前位置：<strong>{joinPath(file.path, file.name)}</strong>
      </div>
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 4, maxHeight: 300, overflow: 'auto', padding: 8 }}>
        <Tree
          showIcon
          defaultExpandAll
          defaultSelectedKeys={[file.path]}
          selectedKeys={[selectedPath]}
          onSelect={(keys) => setSelectedPath(keys[0])}
          treeData={treeData}
        />
      </div>
    </Modal>
  );
}

export default MoveDialog;
