import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import FileManager from './components/FileManager';
import SharePage from './pages/SharePage';
import LogsPage from './pages/LogsPage';

function App() {
  return (
    <Routes>
      <Route path="/s/:token" element={<SharePage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route path="/logs" element={<LogsPage />} />
      <Route path="/" element={
        <Layout>
          <FileManager />
        </Layout>
      } />
    </Routes>
  );
}

export default App;
