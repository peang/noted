import { useState, useEffect } from 'react';

export interface MentionState {
  active: boolean;
  searchTerm: string;
}

export function useFileMention(input: string, cursorPos: number): MentionState {
  const [state, setState] = useState<MentionState>({ active: false, searchTerm: '' });

  useEffect(() => {
    const textBefore = input.slice(0, cursorPos);
    const match = textBefore.match(/(?:^|[\s\n])@([^\s]*)$/);

    if (!match) {
      setState({ active: false, searchTerm: '' });
      return;
    }

    let searchTerm = match[1];
    searchTerm = searchTerm.replace(/[,.;:!?)\]}]+$/, '');

    setState({ active: true, searchTerm });
  }, [input, cursorPos]);

  return state;
}
