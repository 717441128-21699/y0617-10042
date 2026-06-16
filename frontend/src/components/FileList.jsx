import React, { useState } from 'react';
import { Table, Checkbox, Dropdown, Menu, Button, Modal, message, Input } from 'antd';
import { 
  FolderOutlined, 
  FileOutlined, 
  FileImageOutlined,
  VideoCameraOutlined,
  FilePdfOutlined,
  AudioOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  ShareAltOutlined,
  DownloadOutlined,
  EyeOutlined,
  SwapOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import useStore from '../store';
import { fileApi, previewApi } from '../api';
import { formatFileSize, getFileIconClass } from '../utils/path';
import { joinPath } from '../utils/path';

const getFileIcon = (name, type) => {
  const iconClass = getFileIconClass(name, type);
  
  if (type === 'folder') return <FolderOutlined className={`file-icon ${iconClass}`} />;
  if (iconClass === 'image-icon') return <FileImageOutlined className={`file-icon ${iconClass}`} />;
  if (iconClass === 'video-icon') return <VideoCameraOutlined className={`file-icon ${iconClass}`} />;
  if (iconClass === 'pdf-icon') return <FilePdfOutlined className={`file-icon ${iconClass}`} />;
  if (iconClass === 'audio-icon') return <AudioOutlined className={`file-icon ${iconClass}`} />;
  return <FileOutlined className={`file-icon ${iconClass}`} />;
};

function FileList({ onPreview, onShare, onMove }) {
  const { files, selectedFiles, setSelectedFiles, currentPath, fetchFiles, refresh } = useStore();
  const [loading, setLoading] = useState(false);
  const [renameModal, setRenameModal] = useState({ open: false, file: null, newName: '' });

  const handleSelect = (record) => {
    const newSelected = selectedFiles.includes(record.id)
      ? selectedFiles.filter(id => id !== record.id)
      : [...selectedFiles, record.id];
    setSelectedFiles(newSelected);
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedFiles(files.map(f => f.id));
    } else {
      setSelectedFiles([]);
    }
  };

  const handleDoubleClick = (record) => {
    if (record.type === 'folder') {
      const newPath = joinPath(record.path, record.name);
      fetchFiles(newPath);
    } else {
      onPreview(record);
    }
  };

  const handleRename = async (record) => {
    setRenameModal({ open: true, file: record, newName: record.name });
  };

  const confirmRename = async () => {
    if (!renameModal.newName.trim()) {
      message.error('请输入名称');
      return;
    }
    
    try {
      setLoading(true);
      await fileApi.renameFile(renameModal.file.id, renameModal.newName.trim());
      message.success('重命名成功');
      setRenameModal({ open: false, file: null, newName: '' });
      refresh();
    } catch (e) {
      message.error(e.response?.data?.error || '重命名失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (record) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 "${record.name}" 吗？${record.type === 'folder' ? '文件夹内的所有内容将一并删除。' : ''}`,
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          setLoading(true);
          await fileApi.deleteFile(record.id);
          message.success('删除成功');
          refresh();
        } catch (e) {
          message.error(e.response?.data?.error || '删除失败');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleDownload = (record) => {
    if (record.type === 'folder') {
      message.info('请选择文件进行下载');
      return;
    }
    window.open(previewApi.downloadFile(record.id));
  };

  const getMenu = (record) => (
    <Menu>
      {record.type !== 'folder' && (
        <>
          <Menu.Item key="preview" icon={<EyeOutlined />} onClick={() => onPreview(record)}>
            预览
          </Menu.Item>
          <Menu.Item key="download" icon={<DownloadOutlined />} onClick={() => handleDownload(record)}>
            下载
          </Menu.Item>
          <Menu.Item key="share" icon={<ShareAltOutlined />} onClick={() => onShare(record)}>
            分享
          </Menu.Item>
        </>
      )}
      <Menu.Item key="move" icon={<SwapOutlined />} onClick={() => onMove(record)}>
        移动到
      </Menu.Item>
      <Menu.Item key="rename" icon={<EditOutlined />} onClick={() => handleRename(record)}>
        重命名
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item key="delete" icon={<DeleteOutlined />} danger onClick={() => handleDelete(record)}>
        删除
      </Menu.Item>
    </Menu>
  );

  const columns = [
    {
      width: 50,
      render: (_, record) => (
        <Checkbox
          checked={selectedFiles.includes(record.id)}
          onChange={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleSelect(record);
          }}
        />
      )
    },
    {
      title: '名称',
      dataIndex: 'name',
      render: (text, record) => (
        <div className="file-name-cell">
          {getFileIcon(text, record.type)}
          <span>{text}</span>
        </div>
      )
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 120,
      render: (size, record) => record.type === 'folder' ? '-' : formatFileSize(size)
    },
    {
      title: '修改时间',
      dataIndex: 'updated_at',
      width: 180,
      render: (time) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '操作',
      width: 80,
      render: (_, record) => (
        <Dropdown overlay={getMenu(record)} trigger={['click']}>
          <Button
            type="text"
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      )
    }
  ];

  return (
    <>
      <Table
        size="middle"
        columns={columns}
        dataSource={files}
        rowKey="id"
        loading={loading}
        pagination={false}
        onRow={(record) => ({
          onDoubleClick: () => handleDoubleClick(record)
        })}
        locale={{ emptyText: '该目录为空' }}
        rowSelection={{
          selectedRowKeys: selectedFiles,
          onSelect: (record) => handleSelect(record),
          onSelectAll: handleSelectAll
        }}
        showSorterTooltip={false}
      />

      <Modal
        title="重命名"
        open={renameModal.open}
        onOk={confirmRename}
        onCancel={() => setRenameModal({ open: false, file: null, newName: '' })}
        confirmLoading={loading}
      >
        <div style={{ marginBottom: 16 }}>
          <span>原名称：</span>
          <strong>{renameModal.file?.name}</strong>
        </div>
        <Input
          value={renameModal.newName}
          onChange={(e) => setRenameModal(prev => ({ ...prev, newName: e.target.value }))}
          placeholder="请输入新名称"
          onPressEnter={confirmRename}
        />
      </Modal>
    </>
  );
}

export default FileList;
