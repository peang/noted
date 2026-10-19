import { useState, useEffect } from 'react';

export interface MentionState {
  active: boolean;
  searchTerm: string;
  // Index of the @ in the input, -1 when inactive
  start: number;
}

export function useFileMention(input: string, cursorPos: number): MentionState {
  const [state, setState] = useState<MentionState>({ active: false, searchTerm: '', start: -1 });

  useEffect(() => {
    const textBefore = input.slice(0, cursorPos);
    const match = textBefore.match(/(?:^|[\s\n])@([^\s]*)$/);

    if (!match) {
      setState({ active: false, searchTerm: '', start: -1 });
      return;
    }

    let searchTerm = match[1];
    searchTerm = searchTerm.replace(/[,.;:!?)\]}]+$/, '');

    setState({ active: true, searchTerm, start: textBefore.length - match[1].length - 1 });
  }, [input, cursorPos]);

  return state;
}
