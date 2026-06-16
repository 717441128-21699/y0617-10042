import React, { useState, useEffect } from 'react';
import { Table, Select, DatePicker, Card, Row, Col, Statistic, Button, Space, Tag } from 'antd';
import { 
  CloudUploadOutlined, 
  CloudDownloadOutlined, 
  DeleteOutlined, 
  ShareAltOutlined,
  FolderAddOutlined,
  EyeOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { logApi } from '../api';
import { CloudOutlined, HistoryOutlined } from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';

const { RangePicker } = DatePicker;

const ACTION_CONFIG = {
  upload: { label: '上传', icon: <CloudUploadOutlined />, class: 'action-upload' },
  quick_upload: { label: '秒传', icon: <CloudUploadOutlined />, class: 'action-upload' },
  download: { label: '下载', icon: <CloudDownloadOutlined />, class: 'action-download' },
  share_download: { label: '分享下载', icon: <CloudDownloadOutlined />, class: 'action-download' },
  delete: { label: '删除', icon: <DeleteOutlined />, class: 'action-delete' },
  create_folder: { label: '新建文件夹', icon: <FolderAddOutlined />, class: 'action-folder' },
  move: { label: '移动', icon: <FolderAddOutlined />, class: 'action-folder' },
  rename: { label: '重命名', icon: <FolderAddOutlined />, class: 'action-folder' },
  create_share: { label: '创建分享', icon: <ShareAltOutlined />, class: 'action-share' },
  update_share: { label: '更新分享', icon: <ShareAltOutlined />, class: 'action-share' },
  revoke_share: { label: '撤销分享', icon: <ShareAltOutlined />, class: 'action-share' },
  share_view: { label: '分享浏览', icon: <EyeOutlined />, class: 'action-preview' },
  preview: { label: '预览', icon: <EyeOutlined />, class: 'action-preview' }
};

function LogsPage() {
  const location = useLocation();
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });
  const [filters, setFilters] = useState({
    action: undefined,
    dateRange: undefined
  });

  const fetchLogs = async (page = 1, pageSize = 20) => {
    try {
      setLoading(true);
      const params = {
        page,
        pageSize,
        action: filters.action,
        ...(filters.dateRange && {
          startDate: filters.dateRange[0]?.format('YYYY-MM-DD'),
          endDate: filters.dateRange[1]?.format('YYYY-MM-DD')
        })
      };
      
      const res = await logApi.getLogs(params);
      setLogs(res.data.logs);
      setPagination({
        current: page,
        pageSize,
        total: res.data.pagination.total
      });
    } catch (e) {
      console.error('Fetch logs error:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const params = {
        ...(filters.dateRange && {
          startDate: filters.dateRange[0]?.format('YYYY-MM-DD'),
          endDate: filters.dateRange[1]?.format('YYYY-MM-DD')
        })
      };
      const res = await logApi.getStats(params);
      setStats(res.data);
    } catch (e) {
      console.error('Fetch stats error:', e);
    }
  };

  useEffect(() => {
    fetchLogs(1, pagination.pageSize);
    fetchStats();
  }, [filters]);

  const handleTableChange = (newPagination) => {
    fetchLogs(newPagination.current, newPagination.pageSize);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setFilters({ action: undefined, dateRange: undefined });
  };

  const renderAction = (action) => {
    const config = ACTION_CONFIG[action] || { label: action, class: '' };
    return (
      <Tag className={config.class}>
        {config.icon} {config.label}
      </Tag>
    );
  };

  const columns = [
    {
      title: '操作',
      dataIndex: 'action',
      width: 120,
      render: renderAction
    },
    {
      title: '文件名',
      dataIndex: 'file_name',
      render: (text) => text || '-'
    },
    {
      title: '详情',
      dataIndex: 'details',
      render: (details) => {
        if (!details) return '-';
        if (details.size) {
          return (
            <span>
              {details.targetPath && <Tag color="blue">路径: {details.targetPath}</Tag>}
              {details.size && <Tag>{formatFileSize(details.size)}</Tag>}
            </span>
          );
        }
        if (details.from && details.to) {
          return (
            <span>
              <Tag color="orange">从: {details.from}</Tag>
              <Tag color="green">到: {details.to}</Tag>
            </span>
          );
        }
        return <span style={{ color: '#999' }}>{JSON.stringify(details)}</span>;
      }
    },
    {
      title: 'IP地址',
      dataIndex: 'ip',
      width: 140,
      render: (ip) => <code style={{ color: '#666' }}>{ip}</code>
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 180,
      render: (time) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')
    }
  ];

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

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

      <div className="logs-container">
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic 
                title="总操作数" 
                value={stats?.totalStats?.totalOperations || 0}
                prefix={<HistoryOutlined />}
              />
            </Col>
            <Col span={6}>
              <Statistic 
                title="上传次数" 
                value={stats?.totalStats?.totalUploads || 0}
                prefix={<CloudUploadOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Col>
            <Col span={6}>
              <Statistic 
                title="下载次数" 
                value={stats?.totalStats?.totalDownloads || 0}
                prefix={<CloudDownloadOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={6}>
              <Statistic 
                title="分享次数" 
                value={stats?.totalStats?.totalShares || 0}
                prefix={<ShareAltOutlined />}
                valueStyle={{ color: '#722ed1' }}
              />
            </Col>
          </Row>
        </Card>

        <Card
          title={
            <Space>
              <HistoryOutlined />
              <span>操作日志</span>
            </Space>
          }
          extra={
            <Space>
              <Select
                placeholder="操作类型"
                style={{ width: 150 }}
                allowClear
                value={filters.action}
                onChange={(v) => handleFilterChange('action', v)}
                options={Object.entries(ACTION_CONFIG).map(([key, config]) => ({
                  label: config.label,
                  value: key
                }))}
              />
              <RangePicker
                value={filters.dateRange}
                onChange={(v) => handleFilterChange('dateRange', v)}
              />
              <Button 
                icon={<ReloadOutlined />} 
                onClick={handleReset}
              >
                重置
              </Button>
              <Button 
                type="primary" 
                icon={<ReloadOutlined />} 
                onClick={() => {
                  fetchLogs(pagination.current, pagination.pageSize);
                  fetchStats();
                }}
              >
                刷新
              </Button>
            </Space>
          }
        >
          <Table
            columns={columns}
            dataSource={logs}
            rowKey="id"
            loading={loading}
            pagination={{
              ...pagination,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`
            }}
            onChange={handleTableChange}
          />
        </Card>
      </div>
    </div>
  );
}

export default LogsPage;
