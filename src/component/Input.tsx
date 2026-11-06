import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { stdout } from 'process';

type InputProps = {
  placeholder?: string;
  onSubmit?: (value: string) => void;
  focus?: boolean;
  disabled?: boolean;
};

export const Input: React.FC<InputProps> = ({
  placeholder = '请输入...',
  onSubmit,
  focus = true,
  disabled = false,
}) => {
  const [value, setValue] = useState('');
  // 用 ref 同步最新值，避免快速输入时读到旧 state
  const valueRef = useRef('');

  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };

  // 终端列数，保底 80
  const columns = stdout?.columns ?? 80;
  // 80% 宽度，再减去 padding 占用的字符（paddingX={1} 左右共 2）
  const boxWidth = Math.floor(columns * 0.8) - 2;

  useInput((char, key) => {
    if (!focus || disabled) return;

    // 回车提交：只有这一刻才通知父组件
    if (key.return) {
      const final = valueRef.current.trim();
      if (final) onSubmit?.(final);
      update('');
      return;
    }

    if (key.backspace|| key.delete) {
      update(valueRef.current.slice(0, -1));
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) return;
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;

    // 关键：允许多字节字符 / 粘贴整段中文
    if (char) {
      update(valueRef.current + char);
    }
  });

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} width={boxWidth}>
      <Text color="cyan">❯ </Text>
      {value.length === 0 ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        <Text>{value}</Text>
      )}
      {focus && !disabled && <Text color="cyan">▋</Text>}
    </Box>
  );
};