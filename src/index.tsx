// 读取.env文件
import 'dotenv/config';

import React, { useState } from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import { Input } from './component/Input';
import { FileExplorer } from './component/FileExplorer';

const App: React.FC = () => {
  const [history, setHistory] = useState<string[]>([]);
  const [dirPath, setDirPath] = useState<string | null>(null);
  const { exit } = useApp();

  useInput((_char, key) => {
    if (key.ctrl && _char === 'c') {
      exit();
    }
  });

  const handleSubmit = (text: string) => {
    if (text.startsWith('/open ')) {
      const p = text.slice(6).trim();
      setDirPath(p);
      setHistory(prev => [...prev, `📂 打开: ${p}`]);
      return;
    }

    setHistory(prev => [...prev, text]);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>
        ✅ hei-code (TSX)
      </Text>
      <Text dimColor>
        输入消息 | /open &lt;路径&gt; | Ctrl+C 退出
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {history.map((h, i) => (
          <Text key={i}>{h}</Text>
        ))}
      </Box>

      {/* ✅ 文件浏览器组件 */}
      <FileExplorer dirPath={dirPath} />

      <Input placeholder="输入命令或消息" onSubmit={handleSubmit} />
    </Box>
  );
};

render(<App />,{ exitOnCtrlC: true });