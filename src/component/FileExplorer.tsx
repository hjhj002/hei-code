// src/FileExplorer.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs/promises';
import path from 'path';

type FileExplorerProps = {
  dirPath: string | null;
};

export const FileExplorer: React.FC<FileExplorerProps> = ({ dirPath }) => {
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dirPath) return;

    setLoading(true);
    setError(null);

    fs.readdir(path.resolve(dirPath), { withFileTypes: true })
      .then(entries => {
        const list = entries.map(entry =>
          entry.isDirectory() ? `${entry.name}/` : entry.name,
        );
        setFiles(list);
      })
      .catch(err => {
        setError(err.message);
        setFiles([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dirPath]);

  if (!dirPath) {
    return (
      <Box marginTop={1}>
        <Text dimColor>未打开文件夹</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor="yellow"
      padding={1}
    >
      <Text bold color="yellow">
        📁 {path.resolve(dirPath)}
      </Text>

      {loading && <Text dimColor>读取中...</Text>}
      {error && <Text color="red">❌ {error}</Text>}

      {!loading && !error &&
        files.map((file, i) => (
          <Text key={i} color={file.endsWith('/') ? 'cyan' : 'white'}>
            {file}
          </Text>
        ))}
    </Box>
  );
};